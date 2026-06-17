# KoldField — Pedido offline "pendiente de envío": viabilidad + diseño + decisión

**Estado:** spec/diseño. **No implementado todavía** — requiere una **decisión de negocio/seguridad** (ver §6) porque revierte una salvaguarda explícita de Sebastián y toca dinero/inventario sin el guard backend (#116) desplegado.
**Base:** `main` @ `e188275`.

## 1. Veredicto de viabilidad
**Técnicamente VIABLE sin cambios de backend.** La infraestructura de cola para ventas **ya existe (dormida)**:
- `SyncItemType` incluye **`sale_order`** (prioridad 1) — `src/types/sync.ts`.
- **Dispatcher** `case 'sale_order'` → `createSale(buildSalesCreatePayload(payload), meta)` — `useSyncStore.ts:736`.
- **Rollback** de stock local en fallo — `useSyncStore.ts:891`.
- **Máquina de estado** `getSaleSyncState` → `none|pending|done|failed` — `saleSyncState.ts`.
- **Retry** `rearmSaleOrderForRetry` — `saleRetry.ts`.
- **Checkout** ya consume `liveSaleSyncState`/`retrySaleSync` (muestra "sincronizando/fallida" + reintento).
- **Fotos**: dispatcher `case 'photo'` sube vía `uploadStopImage` leyendo base64 desde `localUri` → **replayable offline**.
- **Bloqueos**: `cashcloseGuard.canConfirmLiquidation` y `routeCloseGuard.canCloseRoute` ya bloquean con `pendingCount/errorCount/deadCount > 0` → un `sale_order` en cola **ya impide** liquidar/cerrar. ✅ sin trabajo extra.

**Hoy nadie encola `sale_order`** (`grep enqueue('sale_order')` = vacío): la pantalla de venta llama `createSale` **directo** (online-first), gateada por `!isOnline` (hardening #42). El camino de cola quedó como andamiaje.

## 2. Respuestas Hito 1 (auditoría)
1. **¿Existe sync para venta?** Sí, `sale_order` completo pero sin productor.
2. **¿Por qué no se encola hoy?** Decisión deliberada #42 (online-first; rule de Sebas "no venta offline como pendiente si backend requiere conexión").
3. **¿Qué impide avanzar offline?** El guard `!isOnline` hace `return` antes de crear/encolar → no hay pedido → la visita no puede cerrarse como vendida.
4. **¿Qué payload/fotos se requieren?** `buildSalesCreatePayload({partner_id, stop_id/offroute_visit_id, warehouse_id, _operationId, pricelist_id, analytic_*, payment_method, create_invoice, lines[]})` (autocontenido) + foto como item `photo` con `localUri` (dependsOn la venta).
5. **¿cashclose/route-close bloquean?** Sí, por conteos de cola — ya cubierto.

## 3. Estados propuestos (reusan el status nativo de la cola)
| Estado lógico | Cola (`SyncItemStatus`) | UI |
|---|---|---|
| `pending_sync` | `pending` | "Pendiente de envío" (cliente/ruta/sync) |
| `syncing` | `syncing` | "Enviando…" |
| `confirmed` | `done` | "Enviado" |
| `sync_error` | `error` | "Error" + detalle |
| `dead` | `dead` | "Error (requiere acción)" |
No se inventa una máquina nueva: `getSaleSyncState` ya mapea `pending/done/failed`; se añade el rótulo "pendiente de envío" y el badge por-cliente.

## 4. Diseño de implementación (PR enfocado, reusa lo dormido)
1. **`sale/[stopId].tsx`** — cuando `!isOnline` y el usuario confirme:
   - construir el MISMO payload (con `operation_id` estable ya existente: `lockSaleConfirm()`),
   - `enqueue('sale_order', payload, { meta })` + `enqueue('photo', {localUri, stop_id, image_type:'sale'}, { dependsOn: saleOpId })`,
   - **NO** marcar `saleConfirmed`; marcar el stop como `pending`/`done-pendiente` (estado visual distinto a vendido-confirmado),
   - guardar snapshot/ticket como "pendiente",
   - Alert "Pedido guardado. Se enviará cuando haya conexión." → permitir avanzar (checkout/siguiente).
   - **NO** crear pago ni descontar stock definitivo.
2. **Sync** (ya hecho por la cola): al reconectar, `processQueue` envía `sale_order` → `createSale`. OK→`done`; rechazo→`error` con `error_message`. `insufficient_stock` (cuando #116 lo mande) → `describeInsufficientStock` ya parsea `data.lines`.
3. **UI de estado** — badge por-cliente en ruta/lista + sección en Sync (ya muestra la cola). Checkout ya muestra el estado de la venta.
4. **Bloqueos** — sin cambios (cashcloseGuard/routeCloseGuard ya bloquean por conteos).
5. **Texto del botón** — `!isOnline` → "Guardar pedido pendiente"; online → "Confirmar Pedido" (banner offline de #44 ya existe).

### Política de stock local (DECISIÓN, ver §6)
- **Opción S1 (recomendada, cumple la regla del goal):** NO descontar stock local al encolar. El display sigue mostrando stock; el backend valida al sincronizar. Requiere **ajustar el rollback dormido** (`useSyncStore.ts:891`) para que NO re-restaure si no hubo deducción (hoy asume deducción).
- **Opción S2:** descuento optimista local (qty_reserved) al encolar + el rollback existente restaura en fallo. Mejor señal visual de "ya comprometido", pero es "descontar local" que el goal pide evitar y puede ocultar disponibilidad real entre clientes.

## 5. Tests / QA (cuando se implemente)
- offline encola `sale_order` + `photo`; **no** marca `saleConfirmed`; **no** crea pago.
- `getSaleSyncState` pending→done en sync OK; failed en rechazo.
- retry usa el mismo `operation_id` (idempotencia backend ya existe).
- `insufficient_stock` → estado error con `available_qty`.
- cashclose/route-close bloquean con `sale_order` en cola (ya cubierto; añadir test de regresión).
- doble-tap no duplica (lock + operation_id).
- QA doc `KOLDFIELD_OFFLINE_ORDER_SYNC_QA.md` con los 8 casos.

## 6. ⚠️ Decisión requerida antes de implementar (por qué me detengo)
1. **Revierte una salvaguarda explícita de Sebastián** (#42 / rule "no venta offline como pendiente si backend requiere conexión"). Implementarlo unilateralmente cambiaría el flujo de **dinero/inventario** que él blindó. → **Necesita su visto bueno / coordinación.**
2. **#116 (stock guard duro + idempotencia) NO está desplegado** (draft, BLOCKED en staging). Sin él:
   - dos pedidos offline pueden **sobrevender**; el rechazo solo aparece al sincronizar (a horas), cuando el vendedor ya se fue del cliente;
   - al sincronizar, `createSale` **confirma la venta y crea el cobro en efectivo** server-side → un "pendiente" se vuelve **venta real + pago** diferido. El corte/liquidación deben esperar a que sincronice (ya bloqueado), pero el riesgo de oversell persiste hasta #116.
3. **Política de stock local** S1 vs S2 (§4).

**Recomendación:** implementar **después** (o en conjunto) de tener **#116 en staging/validado** (barrera dura anti-sobreventa) y con **OK de Sebastián**, usando **S1** (no descontar local). Mientras tanto, el comportamiento actual (#42 bloquea + #44 avisa) es el seguro. Si el negocio decide asumir el riesgo antes de #116 (piloto controlado, stock holgado, supervisión), se puede implementar con S1 + aviso claro "pendiente, no confirmado".

## 7. Qué falta / dependencias
- **Negocio/Sebas:** confirmar reversión de la regla #42 y aceptar el modelo "pedido diferido = venta real al sincronizar".
- **Backend #116:** barrera dura de stock + `insufficient_stock` con `data.lines` (la app ya es forward-compatible) + idempotencia (ya existe por `operation_id`).
- **App (este spec):** wiring del productor `enqueue('sale_order')` + foto + estados/badges + ajuste del rollback (S1) + tests/QA. PR estimado: enfocado, ~6-8 archivos.
