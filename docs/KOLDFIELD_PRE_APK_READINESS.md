# KoldField — Readiness pre-APK

**Fecha:** 2026-06-17 · **Base:** `main` @ `5a3ecdb` · **typecheck:** limpio · **tests:** 124/124
**Veredicto:** ✅ **GO_APK_QA** (APK de pruebas/piloto). Para **producción**: **GO_WITH_BACKEND_BLOCKERS** (depende de #116 en staging).

## 1. Qué quedó cerrado (mergeado en main)
- **Performance Fase 1** (#28/#29/#30): TTL precios jornada, debounce, FlatList, timeouts offline-aware, batch persistQueue, selectors, boot paralelo, GPS timeout, guards fetch-on-focus.
- **Fase 2 CEDIS/cache** (#31–#35): plan 2A, caché persistente productos/precios (2B), Preparar ruta + gate de salida + badge (2C), consignaciones lectura cacheada (2D-1), sync al regreso + gate de cierre + limpieza de jornada (2E).
- **Liquidación UX** (#37): botón "Confirmar liquidación" ya no se deshabilita en silencio (muestra la razón); card de sync no miente con error/dead.
- **Refill** (#38): muestra todos los productos (no `slice(0,10)`), agotados primero, buscable, `operation_id`.
- **Regalo offline** (#39): encola si falla sin red (dispatcher `gift` en sync queue), `operation_id` estable, no duplica.
- **Lealtad** (#40): botón conectado a pantalla real de lectura (res.partner `x_loyalty_*`), sin placeholder.
- **Hardening offline/cache de venta** (#42): ProductPicker sin red **ya no se queda cargando** (guard `isOnline` → cae a `list_price` referencial, sin spinner eterno); venta offline sigue bloqueada con mensaje y **no** se encola como confirmada; `unwrapRestResult` preserva `data`/`error_code`; **`insufficient_stock`** ahora muestra producto/`requested_qty`/`available_qty` y refresca el inventario real (cuando el backend #116 envíe `data.lines`). El **#116** sigue siendo la **barrera dura anti-sobreventa** (staging).

## 2. Matriz pantalla por pantalla (pre-APK)

| Pantalla | Estado | Datos | Botones | Offline/cache | Riesgo | GO/NO-GO |
|---|---|---|---|---|---|---|
| login | OK | código+PIN | Iniciar sesión | no detecta offline (msg) | Bajo | GO |
| home | OK | plan/stops/ventas/alerts | CTA operación, refrescar, mapa | refrescar disabled offline + msg | Bajo | GO |
| route-start / preparar ruta | OK | checklist/KM/carga/prep datos | gate "Iniciar ruta" con razón (2C) | gate por mínimo en caché | Bajo | GO |
| ruta/lista/mapa | OK | stops/GPS/ventas | analíticas, ranking, actualizar, mapa | FlatList + badge caché | Bajo | GO |
| cliente/stop | OK | stop/GPS/score/demand | check-in, datos, venta, regalo, no-venta, **lealtad**, consignación | lectura local | Bajo | GO |
| venta | OK | saleLines/pago/foto/stock | agregar, pago, foto, confirmar | online-first + revalida stock; guards | Medio (stock guard duro = backend #116) | GO |
| ProductPicker | OK | productos/precios/imágenes | refrescar, toggle, seleccionar | debounce + precios cacheados (2B) | Bajo | GO |
| checkout | OK | resumen/sync/GPS/next | confirmar, cerrar, reintentar sync | enqueue offline + retry | Bajo | GO |
| no-venta | OK | razones/competidor/foto | chips, foto, guardar | enqueue offline | Bajo | GO |
| regalo | OK | productos/stock/plaza | agregar/quitar, registrar | **encola offline (#39)** | Bajo | GO |
| lealtad | OK | res.partner x_loyalty_* | (lectura) | sin caché → msg claro | Bajo | GO |
| consignación | OK | activa (cacheada 2D-1) | crear/visita/cerrar | lectura offline; mutaciones online-first | Medio (dedup visit/close = backend) | GO |
| preventa | OK | búsqueda/productos/fecha | buscar, agregar, confirmar | online-first con msgs | Bajo | GO |
| refill | OK | productos van | ±, buscar, enviar | enqueue + operation_id (#38) | Bajo | GO |
| incidentes | OK | categorías/severidades | chips, reportar | bloquea offline con msg | Bajo | GO |
| sync | OK | cola por status | reintentar, limpiar | estados claros | Bajo | GO |
| cashclose/liquidación | OK | corte/cobranza/efectivo | corte, **confirmar liquidación (#37)** | gate sync bloquea cierre | Medio (idempotencia = backend #116/B9) | GO |
| route-close | OK | KM final/gate sync | KM, cerrar ruta, ir a sincronizar | gate + limpieza jornada (2E) | Medio (idempotencia cierre = #116/B9) | GO |

**Sin bugs críticos de frontend abiertos.** Los riesgos "Medio" son **del backend** (no del APK): la app ya degrada de forma segura (online-first, gates, revalidación).

## 3. Pendientes app NO bloqueantes (post-APK)
- **login**: añadir detección de offline + disabled si campos vacíos (UX menor).
- **Lealtad**: sin caché offline (informativo); redención requiere backend.
- **2D-2 imágenes**: prefetch/caché de imágenes de producto — depende de **B4 (Cache-Control)**.
- Pulidos de "disabled sin tooltip" en selectores (gift/presale).

## 4. Pendientes BLOQUEADOS por backend (no frenan el APK de QA; sí producción)
- **#116** (GrupoVeniu/GrupoFrio, draft, BLOCKED_PENDING_SAFE_VALIDATION): stock guard duro + `insufficient_stock` + idempotencia de cierre/liquidación. Despliega directo a prod → requiere staging (ver `KOLDFIELD_BACKEND_B6B7B9_STAGING_TEST_KIT.md`).
- **B5** estabilidad intradía de precios (decisión de negocio).
- **Idempotencia de consignación** visit/close por `operation_id` (gap en `gf_consignment`).
- **B4** Cache-Control en imágenes (`/web/image/...`) para 2D-2.

## 5. Riesgos del APK piloto
- **Sobreventa real**: el frontend revalida stock y bloquea local, pero la barrera dura es backend (#116, en staging). En piloto, mitigar con stock holgado / supervisión.
- **Doble cierre/liquidación ante retry**: el gate frontend evita cerrar con pendientes; la idempotencia-éxito definitiva es backend (#116/B9).
- **Consignación visit/close duplicable** ante retry (sin dedup backend) — operar con conexión estable al cerrar consignación.
- **Lealtad/preventa** requieren conexión (sin caché) — esperado.
- Precios/stock mostrados pueden ser referenciales offline (badge lo indica); el backend manda al confirmar.

## 6. Checklist manual APK (QA en dispositivo)
1. [ ] Build del APK de QA (perfil de pruebas) instala y abre en Android de gama baja.
2. [ ] Login con empleado de prueba.
3. [ ] Home muestra plan del día; Preparar ruta descarga productos/precios; gate "Iniciar ruta" funciona.
4. [ ] Abrir cliente: check-in, **venta** (con foto, efectivo/crédito) confirma online.
5. [ ] **Regalo**: con red registra; **en avión/sin red** queda "guardado para sincronizar"; al reconectar sincroniza (pantalla Sync).
6. [ ] **No-venta** con foto; offline encola.
7. [ ] **Refill**: ver todos los productos, buscar, agotados primero, enviar.
8. [ ] **Consignación**: abrir cliente con consignación (online), reabrir sin red → lectura cacheada; visita/cierre deshabilitados offline.
9. [ ] **Lealtad**: cliente con nivel muestra Bronce/Plata/Oro + racha; cliente sin lealtad → empty; sin red → msg.
10. [ ] **Cashclose**: confirmar corte → confirmar liquidación (botón explica si está bloqueado); con pendientes no permite.
11. [ ] **Cerrar ruta**: KM final + gate de sync; al cerrar limpia caché de jornada.
12. [ ] Reiniciar app en ruta sin red → productos/precios siguen (caché 2B); no se pierde la cola de sync.
13. [ ] Revisar pantalla **Sync**: pendientes drenan al reconectar; nada en "dead" inesperado.

## 7. Próximo paso recomendado
Generar el **APK de QA** y correr el checklist §6 en dispositivo. En paralelo, desbloquear el frente backend: levantar **staging para #116** (kit ya entregado) y resolver B5/idempotencia-consignación/B4 con Sebas. **No** pasar a producción hasta cerrar #116 en staging (GO_WITH_BACKEND_BLOCKERS).
