# KoldField — QA: consistencia offline de flujos secundarios

**Rama:** `feat/koldfield-secondary-offline-consistency` · **Base:** `main` @ `780dec7`
**Objetivo:** cada flujo secundario es consistente offline — si encola, queda "pendiente de envío" y se ve en Sync; si bloquea por seguridad, lo dice con razón clara; **nunca** dice "registrado/confirmado" si solo quedó local. UX/copy-only: sin backend, sin contrato API, sin tocar gates/lógica.

Copy centralizado y testeable en `src/services/secondaryFlowCopy.ts`.

## Matriz offline por flujo

| Flujo | Offline actual | ¿Encola? | Mensaje (antes → ahora) | Riesgo | Decisión |
|-------|----------------|----------|--------------------------|--------|----------|
| **Refill** (solicitar carga) | Encola `prospection` (idempotente por operation_id; no toca inventario al capturar) | **Sí** | "Solicitud enviada · registrada" → **"Solicitud guardada · se enviará al sincronizar"** | Falso "registrada" antes de Odoo | **Encolable seguro** (fix de mensaje) |
| **Consignación** create/visit/close | Bloquea (mutación de inventario de camioneta + folio/conciliación en vivo); lectura usa caché read-only | No (por diseño) | "La consignación requiere conexión." → **"…requiere conexión para mantener el inventario trazable."** | Inventario no trazable si se encolara | **Debe bloquear** (copy más claro) |
| **Preventa** | Bloquea (cotización sale.order se genera en Odoo con folio; búsqueda de cliente es online) | No (por diseño) | "Conéctate para registrar la preventa." → **"…la cotización se genera en Odoo en el momento."** | Sin folio/ cliente offline | **Debe bloquear** (copy más claro) |
| **insufficient_stock** (venta) | Conserva carrito, NO confirma, refresca inventario | n/a | Líneas + "Ajusta las cantidades…" → **agotados marcados "🔴 AGOTADO" + "Tu pedido NO se ha confirmado"** | Vendedor no nota agotado / cree vendido | **Ya correcto** (mejora UX) |

Clasificación: Refill = *encolable seguro*; Consignación y Preventa = *debe bloquear*; insufficient_stock = *ya correcto* (mensaje mejorado).

## Qué se corrigió

- **Refill:** `refillSavedMessage()` → "Solicitud guardada / Se enviará a tu almacén al sincronizar. Puedes verla en Sincronización." Aparece en Sync como operación pendiente (`prospection`, user-visible). Nunca dice "registrada".
- **insufficient_stock:** `describeInsufficientStock` marca `available_qty === 0` como "🔴 AGOTADO (pediste N)" (sin "disponible 0" ambiguo); el alert usa `insufficientStockActionHint()` → "Ajusta la cantidad o elimina el producto agotado e intenta de nuevo. Tu pedido NO se ha confirmado." Carrito intacto; venta no confirmada.
- **Consignación / Preventa:** copy de bloqueo más claro (explica el porqué). Comportamiento sin cambios (ya bloqueaban).

## Qué se dejó bloqueado por seguridad

- **Consignación** (create/visit/close): requiere conexión. Justificación: muta inventario de la camioneta (resurtido/cobro/devolución), depende de folios y conciliación en tiempo real; no hay modelo local idempotente para la visita/cierre. Encolarlo arriesgaría la trazabilidad del inventario.
- **Preventa**: requiere conexión. La cotización (sale.order draft) se crea en Odoo y devuelve folio en el momento; la búsqueda de cliente es online. Encolarla daría una UX degradada (sin folio) y no aporta valor offline.

## Casos QA (modo avión)

1. **Refill modo avión:** agregar productos → Enviar → alert "Solicitud guardada / se enviará al sincronizar"; en Sync aparece la operación pendiente. Reconectar → sincroniza. (Nunca "registrada" antes de sync.)
2. **Consignación modo avión:** crear/visitar/cerrar → bloqueo "Sin conexión / requiere conexión para mantener el inventario trazable"; con caché previa, lectura read-only con botones de mutación deshabilitados y banner explicativo.
3. **Preventa modo avión:** confirmar → bloqueo "Sin conexión / la cotización se genera en Odoo en el momento". Búsqueda de cliente también bloquea offline.
4. **Reconnect/sync:** el refill encolado se envía al volver online (auto-trigger). Sin duplicados (operation_id estable + idempotencia de cola).
5. **insufficient_stock con disponible 0:** confirmar venta con un producto agotado en backend → alert lista "🔴 AGOTADO (pediste N)" + "Tu pedido NO se ha confirmado"; carrito intacto para corregir; no se marca venta.
6. **Cierre/liquidación con pendientes:** un refill pendiente cuenta en `pendingCount` → cashclose/route-close siguen bloqueando hasta sincronizar (sin cambios).

## Pruebas automáticas (node)

- `tests/secondaryFlowCopy.test.ts` — refill "guardada" (no "registrada/confirmada"); consignación bloqueo con "trazable"; preventa bloqueo con "cotización"; insufficient hint "NO se ha confirmado".
- `tests/insufficientStock.test.ts` — caso `available_qty === 0` → "AGOTADO", sin "disponible 0".
- **typecheck limpio; tests 127/127.**

## Riesgos / notas

- Cambios de copy/UX, sin tocar contratos, gates, sync ni inventario. Bajo riesgo.
- Refill se muestra en Sync como "Operacion" (`prospection`); etiqueta específica "Solicitud de carga" queda como mejora cosmética futura (no se cambió para no tocar el dispatcher).
- La decisión de bloquear consignación/preventa es deliberada (seguridad/trazabilidad); si en el futuro el backend ofrece idempotencia para esos flujos, podrían encolarse.
