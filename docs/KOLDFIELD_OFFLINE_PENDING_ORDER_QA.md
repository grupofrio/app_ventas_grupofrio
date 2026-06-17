# KoldField — QA Checkout con pedido offline pendiente

**Rama:** `fix/koldfield-offline-pending-checkout` · **Base:** `main` @ `3d607cb`
Corrige el bug de campo: con un pedido capturado **sin señal**, el checkout se quedaba "sincronizando con Odoo" y **no dejaba avanzar** al siguiente cliente.

## Causa raíz
Tras #46 (pedido offline pendiente), una venta puede quedar legítimamente en estado `pending` por largo rato (sin señal). Pero el checkout (diseñado pre-#46, asumiendo venta online inmediata) trataba `pending` como "espera bloqueante":
1. `handleCheckout`: `if (saleSyncState.status === 'pending') → Alert "Espera a que la venta termine de sincronizar" + return` → **trampa offline** (nunca resuelve sin señal).
2. Botones de checkout `disabled` cuando `liveSaleSyncState.status === 'pending'` → **no se podía cerrar la visita**.
3. Banner "Sincronizando venta con Odoo…" con spinner → daba a entender bloqueo activo.

## Fix (frontend, enfocado)
- **`checkout/[stopId].tsx`**:
  - Si hay señal, se intenta enviar el pedido **una vez** (`processQueue`) antes de cerrar; si no resuelve o no hay señal → **NO bloquea**: se procede a cerrar la visita (el pedido queda en cola "pendiente de envío"). Se eliminó el `Alert`+`return` bloqueante.
  - Botones de checkout **ya no se deshabilitan** por `pending` (sí siguen deshabilitados por `failed` = rechazo real de Odoo, que ofrece reintento).
  - Rama offline con pedido pendiente: Alert **"Visita cerrada. Pedido pendiente de envío. Se enviará a Odoo cuando haya conexión."** y avanza.
  - Banner `pending` reescrito (sin spinner): "📦 Pedido pendiente de envío. Se enviará a Odoo al reconectar; puedes cerrar la visita y continuar."
- **`route.tsx`**: banner agregado "📦 Pedidos: N pendiente(s) de envío · M con error · toca para ver Sync" (helper puro `pendingOrders`), visible mientras haya `sale_order` en cola.
- **Sync** (`sync.tsx`): ya lista los `sale_order` como "🧾 Venta" con estado Pendiente/Sincronizando/✓ Listo/Error/Fallido (sin cambios).

## Respuestas Hito 1
1. **¿Dónde se guarda la venta offline?** En la cola de sync como `sale_order` (#46), payload autocontenido + foto (`photo` dependsOn). No en el visit store como confirmada.
2. **¿Qué sync item crea?** `sale_order` (+ `photo`).
3. **¿Por qué checkout sincronizaba?** El guard `pending` bloqueante (ahora removido); intentaba esperar la confirmación.
4. **¿Qué bloqueaba cambiar de cliente?** Botones `disabled` por `pending` + el `Alert`+`return`.
5. **¿Qué status queda en el stop?** Tras checkout, `done` (visita cerrada); el pedido sigue su ciclo en la cola.
6. **¿Dónde se muestra "pendiente de envío"?** Banner en checkout + banner agregado en ruta + pantalla Sync (por pedido).

## Sincronización al reconectar (Hito 4 — ya cubierto por #46)
- `connectivity` dispara `processQueue` al volver online → envía `sale_order` vía `createSale` con el mismo `operation_id` (idempotente, no duplica).
- OK → estado "✓ Listo" en Sync; `insufficient_stock` → error con detalle (cuando #116 mande `data.lines`); sesión expirada → la cola marca error y se reintenta tras re-login; error de red → permanece pendiente con backoff.

## Bloqueos de cierre/liquidación (Hito 5 — ya cubierto)
- `cashcloseGuard.canConfirmLiquidation` y `routeCloseGuard.canCloseRoute` bloquean con `pendingCount/errorCount/deadCount > 0`. Un `sale_order` cuenta (solo `gps` se excluye de `isUserVisibleSyncItem`) → **no se puede liquidar ni cerrar ruta con pedidos pendientes/error**. Mensaje claro en cada pantalla.

## Caso principal (paso a paso)
1. Modo avión.
2. Cliente → venta con productos + foto → "Guardar pedido pendiente".
3. Botón muestra "⏳ Pedido pendiente de envío"; banner offline visible.
4. **Checkout:** "Confirmar Check-out" **habilitado** → Alert "Visita cerrada. Pedido pendiente de envío." → avanza al siguiente cliente. (Antes: trabado.)
5. Cambiar al siguiente cliente: OK, sin trabarse.
6. En **Ruta**: banner "📦 Pedidos: 1 pendiente(s) de envío". En **Sync**: "🧾 Venta · Pendiente".
7. Reconectar (salir de modo avión).
8. La cola envía el pedido (auto o "Sincronizar pendientes" en Corte de Caja).
9. Sync: "🧾 Venta · ✓ Listo"; el banner de ruta desaparece.
10. **Cierre/Liquidación:** con el pedido aún pendiente/error → bloqueados con "operaciones pendientes"; una vez enviado → habilitados.

## Pruebas automáticas (node)
- `tests/pendingOrders.test.ts` — resumen de pedidos sin sincronizar + banner.
- `tests/offlineSaleWiring.test.mjs` (#46) — offline encola sale_order; sin descuento local; bloqueos.
- `tests/saleOfflineUx.test.ts` — etiquetas de estado del pedido.
- Cobertura existente: `getSaleSyncState`, `rearmSaleOrderForRetry`, cashcloseGuard/routeCloseGuard.
- **typecheck limpio; tests 125/125.**

## Riesgos / pendientes
- El pedido se confirma+cobra en Odoo **al sincronizar** (modelo S1, #46) — sin **#116** puede sobrevender, detectado al sincronizar. Mitigación piloto: stock holgado + sincronizar pronto.
- Badge **por-cliente** de pedido pendiente en la lista de stops: follow-up menor (hoy: banner agregado en ruta + checkout + Sync).
- `failed` (rechazo de Odoo) sigue bloqueando el checkout de ESE cliente con opción de reintento (intencional: requiere atención); no bloquea otros clientes.
