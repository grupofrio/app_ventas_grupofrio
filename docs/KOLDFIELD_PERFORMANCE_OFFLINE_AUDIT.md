# KoldField — Auditoría de Performance, Offline y Velocidad del Vendedor

**Rama:** `docs/koldfield-performance-offline-audit` (desde `main` `1ed21e8`)
**Fecha:** 2026-06-12 · **Alcance:** auditoría read-only con evidencia `archivo:línea`. **Sin implementación.**
**Contexto:** vendedores con Androids de bajo perfil (poca RAM, pantallas chicas) y datos móviles intermitentes reportan lentitud. Patrón operativo deseado: **cargar en CEDIS con WiFi → operar en ruta → sincronizar al regresar**.

**Base validada:** `npm test` 108/108 ✅ · `npm run typecheck` con **1 error PRE-EXISTENTE** en `src/services/gfTasks.ts:43` (feature de tareas reciente, no relacionado con esta auditoría).

---

## 1. Resumen ejecutivo

La app tiene **buenas bases** (FlatList virtualizado en ProductPicker, markers memoizados con `tracksViewChanges=false`, cola de sync persistida con idempotencia y rollback de stock). La lentitud percibida en campo NO es un solo bug sino la suma de **cuatro causas principales**:

1. **Esperas de red de hasta 45 s que parecen congelamiento.** `DEFAULT_FETCH_TIMEOUT_MS = 45_000` (`api.ts:21`) + **TTL de 5 minutos** en el caché de precios por cliente (`pricelistCache.ts:31`). En ruta sin señal, abrir ProductPicker después de 5 min del último fetch dispara un RPC que cuelga hasta 45 s antes del fallback a precio de lista. Para el vendedor: "la app se trabó".
2. **Re-renders en cascada en gama baja.** Timer de visita a 1 Hz que escribe el store completo + AsyncStorage cada segundo (`useVisitStore.tickTimer`, `checkin/[stopId].tsx:96`); ~14 pantallas con destructuring de store completo (re-render ante cualquier cambio); lista de paradas en `ScrollView + .map()` sin virtualizar (`route.tsx:468`); búsquedas sin debounce (`ProductPicker.tsx:498`).
3. **I/O excesivo en AsyncStorage.** Cada mutación de la cola reescribe TODO el JSON de la cola (`useSyncStore.ts:219,249,271,292,460` → `storage.ts:22-25`); con GPS + ventas puede llegar a miles de escrituras/día de ~100 KB. En gama baja, eso compite con el render.
4. **La precarga CEDIS está incompleta.** "Preparar ruta" precarga plan+stops+productos+precios, pero: los precios caducan a los 5 min; los **productos se borran al reiniciar la app** (`rehydrate.ts:113` — intencional pero deja el picker vacío sin red); no se precargan catálogos (motivos de no-venta), consignaciones activas ni imágenes.

**Riesgo gama baja:** sesión de ruta estimada 450-600 MB de presión de memoria y caídas a 15-22 FPS en lista de paradas/búsqueda (estimación sobre Snapdragon 400 / 1.5 GB RAM).
**Mejorable rápido (frontend-only):** TTL de precios, debounce, FlatList en paradas, selectors, batching de persistencia, timeout corto offline-aware.
**Requiere backend:** endpoints batch/delta para precarga completa, imágenes cacheables, validación de stock al sincronizar.

---

## 2. Mapa de cuellos de botella (Top + tabla completa)

### Top 10
1. **TTL 5 min de precios por cliente → cuelgue de 45 s offline en ProductPicker** — `pricelistCache.ts:31` + `api.ts:21`. **P1.**
2. **Timeout único de 45 s sin modo-offline** — toda llamada en red muerta gira 45 s (loadPlan, precios, prep) — `api.ts:21`. **P1.**
3. **Reescritura completa de la cola por mutación** (write amplification, hasta ~8.6k writes/día con GPS) — `useSyncStore.ts:219+`, `storage.ts:22-25`. **P1.**
4. **Lista de paradas sin virtualizar** — `ScrollView + visibleStops.map()` con 30-100 stops — `route.tsx:468-511`. **P1.**
5. **Búsqueda sin debounce** (ProductPicker `:498`, búsqueda de ruta `route.tsx:243-254`) — filtro+sort por tecla sobre 100-200 items. **P1.**
6. **Timer 1 Hz con persistencia por tick** — `tickTimer` hace `set()` + `persistVisitState()` cada segundo (`useVisitStore.ts:206-213`); pantallas suscritas al store completo re-renderizan a 1 Hz. **P1.**
7. **Productos borrados al reiniciar** (`rehydrate.ts:113`) — tras restart en ruta sin señal, picker vacío hasta tener red. **P1 (operativo).**
8. **Destructuring de store completo en ~14 pantallas** (p.ej. `route.tsx:69`, home `index.tsx:33-51`) — re-render ante cualquier cambio del store. **P2.**
9. **Boot secuencial + GPS init sin timeout** — `_layout.tsx:51-102` encadena auth→rehidratación→GPS→conectividad; en 3G lento 6-10 s a primera pantalla útil. **P2.**
10. **Doble fetch en focus** — home llama `loadPlan`+`loadTodaySales` en mount **y** focus (`index.tsx:54-66`); venta re-llama `loadProducts` en focus (`sale/[stopId].tsx:81-91`). **P2.**

### Tabla completa

| Área | Problema | Evidencia | Impacto | Sev. | Fix recomendado |
|---|---|---|---|---|---|
| Precios | TTL 5 min → re-RPC con 45 s de cuelgue offline | `pricelistCache.ts:31`, `pricelist.ts:494` | "App congelada" frente al cliente | **P1** | TTL a jornada (8-10 h) o hasta refresh manual; precargar reglas de pricelist en prep |
| Red | Timeout 45 s uniforme | `api.ts:21` | Esperas largas percibidas como crash | **P1** | Timeout corto (8-10 s) cuando `isOnline=false` o para lecturas con caché; 45 s solo para mutaciones |
| Sync/IO | Reescritura total de cola por mutación | `useSyncStore.ts:219,249,271,292,311,328,460`; `storage.ts:22-25` | Miles de writes de ~100 KB/día; jank + desgaste | **P1** | Batch/debounce de `persistQueue` (300-500 ms); separar cola GPS de cola de negocio |
| Ruta | Stops en ScrollView+map (30-100 ítems) | `route.tsx:468-511` | 15-20 FPS al abrir lista | **P1** | FlatList (`initialNumToRender=15, windowSize=5`) |
| Búsqueda | Sin debounce (productos y ruta) | `ProductPicker.tsx:498`; `route.tsx:243-254` | Lag por tecla en gama baja | **P1** | Debounce 250-300 ms + memo del filtro |
| Visita | Timer 1 Hz: `set()` + AsyncStorage por segundo | `useVisitStore.ts:206-213`; `checkin/[stopId].tsx:94-99` | Re-render global 1 Hz + I/O continuo | **P1** | Persistir elapsed cada 15-30 s (derivable de `checkInTime`); componente TimerDisplay aislado con selector |
| Arranque | Productos no rehidratados (borrados a propósito) | `rehydrate.ts:113` | Restart en ruta = picker vacío sin red | **P1** | Cachear catálogo de la última sesión marcado "stale"; refresh no bloqueante al recuperar red |
| Stores | Destructuring completo en ~14 pantallas | `route.tsx:69`, `index.tsx:33-51`, etc. | Re-renders en cascada | P2 | Selectors por campo |
| Boot | Secuencial + GPS sin timeout + doble fetch en focus | `_layout.tsx:51-102`; `index.tsx:54-66` | 6-10 s a pantalla útil en 3G | P2 | Promise.all donde sea independiente; `Promise.race` GPS 5 s; guard de frescura en focus |
| ProductPicker | `enrichedProducts` se recalcula al llegar precios; `renderListItem` sin useCallback; imágenes sin caché | `ProductPicker.tsx:207-219, 331-383, 299-327` | Jank al abrir picker y al scroll | P2 | Separar capa precios; useCallback; headers de caché de imagen (backend) |
| Mapa | userLat/userLon como props del screen → re-render del padre por tick GPS | `route.tsx:273-284` | Jank de mapa con 40+ stops | P2 | Aislar ubicación en subcomponente; (markers ya están bien: memo + `tracksViewChanges=false` ✅) |
| Sync UI | Cola en ScrollView sin virtualizar | `sync.tsx:137+` | Jank con 100+ items | P2 | FlatList por sección |
| Logs | Trace HTTP con cuerpos completos de request/response | `api.ts:212-258` | Churn del ring buffer + CPU | P3 | Truncar payloads >1 KB en logs |
| Fotos | Pipeline correcto (archivo, calidad 0.4); subida 1 RPC por foto | `camera.ts:39-40`; `useSyncStore.ts:752-765` | Sync de regreso lento con muchas fotos | P3 | Batch/compresión adicional al regresar |
| GPS | Cap 500 items con evicción del más viejo | `useSyncStore.ts:198-212` | Pérdida de rastro en rutas largas | P3 | Subir cap o flush parcial por lotes |
| Typecheck | Error PRE-EXISTENTE `gfTasks.ts:43` | commits recientes de tasks | CI/typecheck sucio | P2 | Corregir en rama propia (no en perf) |

---

## 3. Estrategia CEDIS WiFi → Ruta → Regreso

### A. En CEDIS (WiFi) — "Preparar ruta" ampliado
**Hoy precarga:** plan+stops (`useRouteStore.loadPlan`), inventario de unidad (`loadProducts`, 3 niveles), precios por cliente (pool de 4 workers, `useRoutePreparationStore`).
**Propuesta — agregar al prep (1 botón, barra de progreso):**
1. Plan + stops + datos de cliente embebidos (ya).
2. Catálogo + stock de unidad (ya) → **persistirlo** para sobrevivir restarts (quitar el borrado de `rehydrate.ts:113`, marcado como "stale, refresh pendiente").
3. Precios por cliente **con TTL de jornada** (no 5 min) + **reglas de pricelist** (para fallback offline real, no solo el mapa de precios).
4. **Catálogos chicos:** motivos de no-venta, razones de merma/scrap, plantillas de checklist (si faltara), giros/canales.
5. **Consignaciones activas** de los clientes del plan (N llamadas `my-active` o un batch si Sebas lo expone).
6. **Imágenes** de los top productos (thumbnail 128) — requiere headers de caché del backend.
7. Resultado visible: "Ruta preparada: 28 clientes, 104 productos, precios OK, 3 consignaciones" + falla por-cliente reintetable (ya existe el patrón de failures).

### B. En ruta (datos móviles / intermitencia)
- **Lecturas:** todo desde caché local (plan, stops, productos, precios, catálogos). Nunca girar 45 s: timeout corto + fallback inmediato a caché con badge "datos de la mañana".
- **Escrituras seguras → cola** (ya hoy): venta*, check-in/out, no-venta, regalo→(evaluar), fotos, GPS, clientes, refill/unload.
- **Online-only (por dinero/inventario, correcto hoy):** consignación, preventa, liquidación, corte, cierre, KM, checklist. Si no hay señal → bloquear con mensaje claro, no girar.
- (*) Venta hoy es **online-first** ("Venta requiere conexión", `sale/[stopId].tsx:190-196`): decisión deliberada post-P0 mientras el backend no garantice stock-guard duro. Mantener hasta cerrar backend P0-B.

### C. Regreso al CEDIS (WiFi)
1. Banner "Estás en WiFi — sincroniza antes de cerrar" → `processQueue()` completo (negocio → fotos → GPS, ya priorizado).
2. `cashcloseGuard` ya bloquea liquidación con `pending/error/dead` ✅ — mantener como gate.
3. Refresh de plan + conciliación → corte → liquidación → KM final → cerrar ruta (gates existentes).

### Qué cachear y qué NO
- **Cachear seguro:** plan/stops, catálogo+stock visible (marcado stale), precios+reglas (TTL jornada), catálogos estáticos, imágenes, consignaciones (solo lectura).
- **NO cachear / NO operar offline:** confirmación de venta sin stock-guard backend, pagos, liquidación/corte/cierre, consignación visit/close (mueven dinero+inventario), conversión de leads. Razón: backend es la fuente de verdad de inventario/cobros/duplicados; operar esto offline arriesga doble cobro o inventario negativo aunque haya `operation_id`.

---

## 4. Matriz offline por flujo

| Flujo | Cacheable (lecturas) | Offline (cola) | Online-only | Riesgo | Recomendación |
|---|---|---|---|---|---|
| Venta | productos+precios | ❌ hoy (online-first deliberado) | ✅ confirmación | Inventario/duplicado | Mantener online-first hasta stock-guard backend; luego evaluar cola con opId |
| Pago/cobro | — | ✅ (tipo `payment` en cola) | preferible online | Dinero | Mantener; dedup backend ya existe |
| No venta | motivos (precargar) | ✅ | — | Bajo | Precargar motivos en CEDIS |
| Check-in/out | stops | ✅ | — | Bajo | OK hoy |
| Regalo | productos | ❌ (online vía gfSalesOps) | ✅ | Inventario | Evaluar cola (baja prioridad); hoy bloquea sin red |
| Consignación | `my-active` (precargar lectura) | ❌ | ✅ create/visit/close | Dinero+inventario | Mantener online-only; precargar solo lectura |
| Preventa | catálogo+precios | ❌ | ✅ | Cotización duplicada | Mantener online-only (decisión previa) |
| Refill/unload/transfer | stock | ✅ (con rollback) | — | Medio | OK hoy |
| Incidente | — | ❌ (online) | ✅ | Bajo | Candidato a encolar (no mueve dinero) |
| KM / checklist | — | ❌ | ✅ | Bajo (es en CEDIS) | OK: ocurre con WiFi |
| Corte/liquidación/cierre | resumen (lectura) | ❌ | ✅ | Dinero | OK: ocurre con WiFi; gate de cola ya existe |
| GPS / fotos | — | ✅ (P3/P2) | — | Bajo | OK; batch fotos al regresar |

---

## 5. UX para atender más rápido al cliente

Flujo actual: lista/mapa → `/stop/[id]` → check-in → venta → picker → carrito → confirmar → checkout. Propuestas (Fase 4):
1. **Productos frecuentes / última compra del cliente** arriba del picker (el backend ya tiene historial de `sale.order` por partner; pedir endpoint "top N del cliente"). Ahorra la búsqueda en el 80% de visitas repetitivas.
2. **"Repetir última venta"** como CTA: precarga el carrito con la última orden y el vendedor solo ajusta cantidades.
3. **Cantidades rápidas** (+1/+5/+10 y último valor usado) en el picker, ya hay stepper; añadir presets.
4. **Precarga de precios al entrar a `/stop/[id]`** (no al abrir el picker) — elimina el spinner de precios frente al cliente (`ProductPicker.tsx:146-170`).
5. **Carrito persistente por visita** ya existe (visitStore); mantener.
6. **Menos taps:** al confirmar venta con skip-checkout ya regresa a ruta ✅; revisar que "no venta" no exija scroll para guardar en pantallas chicas.
7. **Indicador de modo datos:** badge discreto "offline — usando datos de la mañana" en picker/stop para que el vendedor confíe en seguir operando sin esperar la red.

---

## 6. Quick wins

| Fix | Archivo probable | Impacto | Riesgo | Esfuerzo |
|---|---|---|---|---|
| TTL precios 5 min → jornada (con invalidación al re-preparar) | `pricelistCache.ts:31` | Elimina el cuelgue #1 en campo | Bajo (precios del día son estables) | XS |
| Debounce 300 ms búsqueda (picker + ruta) | `ProductPicker.tsx:498`, `route.tsx` | Quita lag por tecla | Bajo | XS |
| FlatList en lista de paradas | `route.tsx:468-511` | Lista fluida con 60+ stops | Bajo | S |
| Batch de `persistQueue` (debounce 300-500 ms) | `useSyncStore.ts` | -90% writes AsyncStorage | Medio (probar crash-recovery) | S |
| Timer: persistir cada 15-30 s + TimerDisplay aislado | `useVisitStore.ts:206-213`, `checkin` | Quita re-render 1 Hz global | Bajo | S |
| Timeout corto offline-aware (8-10 s en lecturas) | `api.ts` | Sin esperas de 45 s | Medio (no tocar mutaciones) | S |
| Selectors en pantallas calientes (route, home, sale, checkout) | 14 pantallas | Menos re-renders cascada | Bajo | S-M |
| Guard de frescura en fetch-on-focus (home/sale) | `index.tsx:54-66`, `sale:81-91` | Menos RPCs repetidos | Bajo | XS |
| `Promise.race` GPS init 5 s + paralelizar boot | `_layout.tsx:51-102` | Arranque -3-5 s | Bajo | S |
| useCallback en renderItem del picker | `ProductPicker.tsx:331-383` | Scroll más fluido | Bajo | XS |
| Truncar payloads en logs HTTP | `api.ts:212-258` | Menos churn CPU/RAM | Bajo | XS |
| No borrar productos al boot (marcar stale) | `rehydrate.ts:113` | Picker usable tras restart offline | Medio (coordinar con regla "stock vivo") | S |

---

## 7. Plan por fases

### Fase 1 — Quick wins de performance (frontend-only, 1 rama)
TTL de precios a jornada · debounce búsquedas · FlatList de paradas · batch de persistQueue · timer aislado · timeout offline-aware en lecturas · selectors en 4-5 pantallas calientes · guards de fetch-on-focus · boot paralelo + GPS timeout · useCallback picker · truncado de logs. **Sin backend, sin cambios de contrato.**

### Fase 2 — Precarga CEDIS / caché de jornada
Prep ampliado (catálogos, consignaciones-lectura, reglas de pricelist, imágenes) · persistir catálogo con flag stale (revisar regla `rehydrate.ts:113` con Sebas) · badge "datos de la mañana" · pantalla de prep con progreso/faltantes. **Parcialmente backend** (batch endpoints, cache headers).

### Fase 3 — Offline robusto
Solo tras confirmar idempotencia/stock-guard backend: evaluar venta encolada offline, regalo e incidente en cola, validación de stock al sincronizar (respuesta `insufficient_stock` → flujo de corrección). **Backend-dependiente; riesgo dinero/inventario documentado.**

### Fase 4 — UX vendedor rápido
Productos frecuentes/última compra (endpoint top-N) · repetir última venta · presets de cantidad · precarga de precios en `/stop/[id]` · micro-ajustes de taps.

**Riesgo de mezclar:** Fase 1 toca render/persistencia (testeable hoy); Fase 2-3 cambian semántica de datos (necesitan a Sebas). Un PR por fase, como en P0/P1/P2.

---

## 8. Preguntas para Sebas / backend

1. **Batch de precarga:** ¿endpoint(s) para traer en 1-2 llamadas: catálogos (motivos no-venta, razones scrap), consignaciones activas de N partners, top-N productos por cliente? Hoy serían 20-30 RPCs sueltos en el prep.
2. **Cache headers en imágenes** (`/web/image/product.product/<id>/image_128`): ¿puede servir `Cache-Control: max-age=604800` para que el device las cachee?
3. **Precios:** ¿los pricelists cambian intradía? Si no, confirmamos TTL de jornada sin riesgo. ¿Posible `last_updated`/delta para refrescar solo lo que cambió?
4. **Stock al sincronizar:** cuando exista el stock-guard (backend P0-B), ¿la venta encolada rechazada por `insufficient_stock` devolverá el detalle por línea para que la app guíe la corrección?
5. **Sync masivo de regreso:** ¿algún límite de rate o conviene un endpoint batch para vaciar la cola (N ventas+checkouts en una llamada)?
6. **`gfTasks.ts:43`:** error de typecheck pre-existente del feature de tareas — corregirlo en su rama.

---

## Estado validado de base
- `main` `1ed21e8` (PRs #18-#25 mergeados).
- `npm test`: 108/108 ✅.
- `npm run typecheck`: 1 error pre-existente (`gfTasks.ts:43`) — no introducido por esta auditoría (es doc-only).
