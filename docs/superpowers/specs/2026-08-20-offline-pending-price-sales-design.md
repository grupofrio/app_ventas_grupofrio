# Venta offline con precio pendiente de confirmar

## Objetivo

Permitir que un vendedor capture una venta offline cuando la preparación de ruta no pudo precargar el precio específico del cliente, sin declarar un precio o total local como definitivo. Odoo mantiene la autoridad de precio al sincronizar la orden.

## Decisión

La preparación de ruta sigue intentando precargar precios por cliente y conserva sus fallos visibles. Esos fallos son advertencias operativas: no bloquean abrir el selector ni agregar productos a una venta.

Cuando no existe precio autorizado en caché para el cliente:

- el selector deja agregar productos y conserva únicamente producto/cantidad para la orden;
- la línea, subtotal y total muestran `Pendiente de confirmar` en vez de un valor cero o una estimación presentada como final;
- la venta queda como pedido offline pendiente de envío, con el mismo `operation_id` durable;
- no se crea ni se declara un cobro definitivo offline. La selección efectivo/crédito conserva su clasificación existente para la orden, pero el importe se confirma sólo con Odoo.

Al sincronizar, el contrato de `sales/create` sigue excluyendo cualquier `price_unit` móvil. El backend resuelve el precio con la lista autorizada del partner y devuelve el resultado/ticket final.

## Alcance

- Frontend KOLD Field solamente.
- Venta directa: selector de productos, estado de línea/total, ticket local y proyección de venta pendiente.
- Pruebas de lógica y wiring para precio pendiente, payload sin autoridad de precio, UUID/cola estable y presentación.

## Fuera de alcance

- Cambios al endpoint Odoo o a la regla de cálculo de precio del backend.
- Consignación y Preventa. Ambas usan el selector compartido, pero mantienen su política actual de precio autorizado.
- Cambios al stock, ledger, day-bundle, idempotencia, conciliación, pago por factura o liquidación.
- Inventar una estimación monetaria para un precio que no está en caché.

## Invariantes

1. El backend es la única autoridad de `price_unit`; el cliente no reintroduce un campo monetario en `sales/create`.
2. Una falta de caché de precios no puede bloquear agregar una línea offline.
3. Un precio pendiente no se presenta como `$0`, precio de lista, ni total cobrable definitivo.
4. El `operation_id` y el payload de producto/cantidad se conservan a través de cola, reinicio y reintento.
5. Los bloqueos existentes de stock, day-bundle y cierre/liquidación no se relajan.

## Criterios de aceptación

- Sin red y sin caché del cliente, el selector permite elegir un producto disponible y la venta muestra precio/total pendientes.
- Con una caché autorizada, la UI conserva el precio y total actuales.
- `buildSalesCreatePayload` sigue enviando sólo identidad de operación, scope permitido, productos, cantidades y descuento; nunca `price_unit` ni un total local.
- Una venta sin precio cacheado se encola y sincroniza con el UUID original.
- La ficha/ticket local identifica claramente que el importe se confirmará al sincronizar.
