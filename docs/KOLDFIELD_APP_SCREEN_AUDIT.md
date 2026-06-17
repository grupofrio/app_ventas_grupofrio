# KoldField — Auditoría de app pantalla por pantalla + fix de liquidación

**Rama:** `fix/koldfield-cashclose-confirm-button`
**Base:** `main` @ `d7c82cf` (Fase 1 perf + Fase 2 CEDIS/cache cerradas).
**Alcance:** diagnóstico/fix del botón "Confirmar liquidación" (prioridad de campo) + auditoría de pantallas. **Frontend-only; sin backend; sin cambios de contrato API.**

## 1. Resumen ejecutivo
El botón "Confirmar liquidación" **sí estaba implementado y cableado**; el reporte de campo ("no funciona") corresponde a un **disable silencioso**: el botón se deshabilita en varios estados legítimos sin explicar por qué, y la tarjeta de sincronización mostraba "Todo sincronizado" aun cuando había operaciones en `error`/`dead`. **Fix frontend mínimo:** se muestra siempre la razón del bloqueo bajo el botón y se corrige la condición de la tarjeta de sync. La lógica de negocio, el servicio y el contrato backend **no se tocaron**. La auditoría del resto de pantallas encontró 1 botón muerto (placeholder de Lealtad), 1 limitación de refill (solo 10 productos) y varios "disabled sin explicación / sin cola offline" en operaciones online-first; **dos hallazgos iniciales se descartaron como falsos positivos tras verificar el código**.

## 2. Bug de liquidación — resultado
**Es frontend (UX), no backend.** El botón vive en `app/cashclose.tsx` y está correctamente conectado: `handleConfirmLiquidation → submitLiquidation → confirmRouteLiquidation` (`/gf/logistics/api/employee/liquidacion/confirm`). El payload está completo (`plan_id`, `cash_collected`, `notes`, `force`, `operation_id` estable). El manejo de respuesta es correcto, incluido el flujo `difference_warning` (verificado: `unwrapRestResult` adjunta `err.code` al lanzar, así que el code sobrevive y el diálogo "Confirmar con diferencia" + retry `force=true` funciona).

## 3. Causa raíz
El botón está `disabled` cuando `!canConfirmFinalLiquidation`, es decir cuando **cualquiera** de:
1. **El corte aún no se confirma** (`!corteAlreadyConfirmed`) — causa más común; el flujo exige "Confirmar corte" antes de liquidar.
2. Hay operaciones `pending`/`error`/`dead` en la cola, o un sync en curso.
3. La liquidación no cargó (`!hasLiquidationData`, p.ej. backend/red).
4. Ya está confirmada / `liquidationBusy`.

**El problema:** en los casos 1–3 el botón quedaba **gris sin ningún texto** que lo explicara. Peor: si había `error`/`dead` con `pendingCount===0`, la tarjeta superior mostraba ✅ **"Todo sincronizado"** (engañoso) mientras el guard seguía bloqueando. Resultado percibido en campo: "el botón no hace nada".

## 4. Fix aplicado (frontend)
- **`src/services/cashcloseGuard.ts`** (puro): nuevo `describeLiquidationButtonBlock(state)` → devuelve la razón exacta del bloqueo (o `null` si habilitado), en orden de prioridad que guía al vendedor (liquidación no disponible → pendientes → con error → sincronizando → **confirma el corte primero**). Espeja las condiciones de habilitación de la pantalla.
- **`app/cashclose.tsx`**:
  - se calcula `liquidationButtonReason` y se **renderiza bajo el botón** cuando está deshabilitado → nunca más un botón gris sin explicación.
  - la tarjeta de sync ahora se muestra en estado "pendiente" si `pendingCount > 0 **|| errorCount > 0 || deadCount > 0**` (antes solo `pendingCount`), evitando el "Todo sincronizado" engañoso con operaciones en error.
- **Sin** cambios de lógica de negocio, servicio ni contrato. La habilitación real (`canConfirmFinalLiquidation`) no cambió; solo se hizo **visible** el motivo.
- **Tests:** `tests/cashcloseGuard.test.ts` extendido con 9 casos para `describeLiquidationButtonBlock` (todo listo→null, ya confirmada→null, liquidación no disponible, pendientes, error/dead, sincronizando, corte no confirmado, prioridad pendientes>corte).

## 5. Matriz pantalla por pantalla

Estados: **OK** · **Bug crítico** · **Botón muerto** · **Disabled sin explicación** · **Falta loading/error** · **Falta offline/cache** · **Depende backend**

| Pantalla | Datos esperados | Botones | Estado | Bug | Prioridad | Recomendación |
|---|---|---|---|---|---|---|
| login | código + PIN; `useAuthStore` | Iniciar sesión | Falta offline/cache | No detecta offline (sin `isOnline`); botón nunca disabled visual | Baja | Mensaje offline + disabled si campos vacíos |
| home `(tabs)/index` | plan, stops, ventas, alerts, productos | CTA operación, Refrescar, Mapa, StopCard | OK | Refrescar ya tiene disabled+mensaje offline | — | — |
| route-start | plan, checklist, KM, carga, **prep datos (2C)** | Checklist, KM, Aceptar carga, **Iniciar ruta** (gate) | OK | Gate de datos con razón (2C) ya implementado | — | — |
| preparación/cache | `useRoutePreparationStore` | Preparar ruta, Reintentar | OK | Progreso/faltantes/errores cubiertos (2B/2C) | — | — |
| ruta/lista/mapa `(tabs)/route` | stops, GPS, ventas, badge caché | Analíticas, Ranking, Actualizar, mapa, visita especial | OK | FlatList + badge caché (Fase 1/2C) | — | — |
| stop `/stop/[stopId]` | stop, GPS/geocerca, KoldScore/Demand, guards | Check-in, Datos/Venta/Regalo/No-venta, Editar, **Lealtad**, Consignación | **Botón muerto** | **"⭐ Lealtad" = `Alert('F8: Programa de lealtad')`** (placeholder) | Baja | Ocultar tras flag o marcar "Próximamente" |
| venta `/sale/[stopId]` | saleLines, pago, foto, stock, plaza | Agregar producto, Efectivo/Crédito, Foto, **Confirmar pedido** | OK | Validación fresca de stock + guards + retry; qty no admite negativo (`\D`) | — | (revisar `warehouseId!` en focus si llega null) |
| ProductPicker | productos, precios cliente, imágenes | Refrescar, toggle vista, seleccionar, cantidades | OK | Debounce + callbacks + badge caché; lee precios cacheados (2B) | — | — |
| checkout `/checkout/[stopId]` | resumen venta, sync state, GPS, next stop | Confirmar check-out (+navegar), Cerrar visita, **Reintentar sync** | OK | Bloquea si venta `pending/failed` + retry visible; enqueue offline | — | — |
| no-venta `/nosale/[stopId]` | razones (hardcoded), competidores, foto, notas | chips razón/competidor, foto, **Guardar** | OK | Toggle competidor **correcto** (local+store en sync); guarda `competitor` | — | (chips sin tooltip, menor) |
| regalo `/gift/[stopId]` | productos, stock, plaza | Agregar/Quitar línea, seleccionar, **Registrar regalo** | Falta offline/cache | Sin cola offline: si falla sin red, no encola (Alert) | Media | Encolar como venta/no-venta (patrón sync) |
| consignación `/consignment/[stopId]` | activa (cacheada 2D-1), líneas | Crear/Visita/Cerrar, Reintentar | OK | Lectura cacheada offline + mutaciones online-first (2D-1) | — | (dedup backend = #116/B9) |
| preventa `/presale.tsx` | búsqueda cliente, productos, fecha | Buscar, Agregar, fecha/chips, **Confirmar** | Falta offline/cache | Online-first con mensajes claros; sin cola (por diseño) | Baja | Documentar que preventa requiere red |
| refill `/refill.tsx` | productos (van) | ±, Reintentar, **Enviar solicitud** | Disabled sin explicación / posible bug | **`products.slice(0,10)`**: solo 10 productos (orden por stock desc → muestra los de MÁS stock, no los que faltan); sin paginación; enqueue sin `operation_id` | Media | Mostrar todos (o buscador) + `operation_id` idempotente |
| refill-accept | plan, carga pendiente | Reportar diferencia, **Aceptar**, Volver | OK | Aceptar disabled offline con label visible | Baja | "Reportar" podría avisar offline antes de navegar |
| incidentes `/incident.tsx` | categorías/severidades, recientes | chips, **Reportar**, Volver | Falta loading/error parcial | `loadRecent` traga error en silencio; sin retry de recientes | Baja | Mostrar error/retry de "recientes" |
| sync `/sync.tsx` | cola por status | **Reintentar**, Limpiar completados, Limpiar errores | OK | Estados claros; status bar offline | Baja | "ver más" si >10 done; cap "intentos /3" |
| cashclose/liquidación | corte, cobranza, efectivo | Guardar corte, Confirmar corte, **Confirmar liquidación**, Sincronizar | **Disabled sin explicación → CORREGIDO** | (este PR) razón inline + card sync por error/dead | — | desplegado en este fix |
| route-close/cierre | KM final, gate sync (2E) | KM, Cerrar ruta (gate), Ir a sincronizar | OK | Gate de sync + limpieza jornada (2E) | — | (idempotencia cierre = #116/B9) |

## 6. Botones muertos o dudosos
- **Stop → "⭐ Lealtad"**: `Alert('F8: Programa de lealtad')`, sin funcionalidad → **botón muerto** (placeholder de feature futura). Prioridad baja: ocultar tras feature flag o etiquetar "Próximamente".
- **Refill → "Enviar solicitud"**: funciona, pero solo opera sobre los **primeros 10 productos** (`slice(0,10)`), que por el orden del store son los de mayor stock (los que menos necesitan recarga). Revisar si es MVP intencional.
- **Disabled sin tooltip (menores):** selector de producto en gift/presale, chips en no-venta — disabled con cue visual pero sin texto; aceptable.

## 7. Bugs críticos antes de APK
1. **(CORREGIDO en este PR)** Liquidación: botón disabled silencioso + card "Todo sincronizado" engañosa.
2. **Refill `slice(0,10)`**: no se pueden solicitar productos fuera del top-10 por stock → puede impedir pedir recarga de lo agotado. **Confirmar intención**; si es bug, mostrar todos + buscador. (Media)
3. **Operaciones sin cola offline** (regalo; preventa por diseño): si fallan sin red, no se encolan como sí lo hacen venta/no-venta/checkout. (Media — riesgo de pérdida de captura en regalo)
> Falsos positivos descartados tras verificar: "no-venta no guarda competidor" (sí lo guarda) y "venta admite qty negativa" (`\D` elimina el signo).

## 8. Pendientes contra auditoría previa
- **Cerrado:** Performance Fase 1 (A/B/C), Fase 2 CEDIS/cache (2A–2E), hardening P0/P2, consignación lectura (2D-1). Liquidación UX (este PR).
- **Depende backend (no bloquea APK del lado app):** stock guard duro + `insufficient_stock` + idempotencia cierre/liquidación → **PR #116 (BLOCKED, staging)**; idempotencia de consignación visit/close (B9, follow-up); B5 precios intradía (decisión negocio).
- **Pendiente app:** 2D-2 imágenes (dep B4); refill top-10; cola offline para regalo; placeholder Lealtad; pulidos de "disabled sin tooltip".
- **Roadmap:** P3/P4 (ver `KOLDFIELD_HARDENING_P2_P3_P4_ROADMAP.md`).

## 9. Próximos PRs recomendados (uno por intención)
1. **(este)** `fix: restore cash close confirmation action` — razón inline + card sync.
2. `fix(refill): mostrar todos los productos + operation_id` (confirmar intención del top-10).
3. `feat(gift): cola offline de regalo` (patrón sync de venta/no-venta).
4. `chore(stop): ocultar/etiquetar botón Lealtad tras feature flag`.
5. `feat(2D-2): caché de imágenes` cuando Sebas entregue **B4 (Cache-Control)**.
