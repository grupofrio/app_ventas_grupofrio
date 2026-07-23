# Proyección de ventas pendientes en la pestaña Ventas

**Fecha:** 2026-07-23

**Estado:** Diseño aprobado

**Entrega:** Continuidad offline 2 de 3

## Objetivo

Una venta creada offline debe aparecer inmediatamente en la pestaña Ventas y sobrevivir reinicios, aunque todavía no exista en Odoo. Su estado debe ser evidente y nunca debe inflar los indicadores oficiales ni el corte antes de que el servidor la confirme.

## Problema actual

`useSalesStore` y la pantalla de Ventas consumen exclusivamente `sales/summary` y `sales/list`. La venta offline sí existe de forma durable en `useSyncStore`, y su ticket se guarda por `operation_id`, pero ninguna de esas fuentes se proyecta en la lista.

La cola ya contiene lo necesario para identificar la operación:

- `id` como `operation_id`;
- `created_at`;
- estado y error;
- payload con cliente, total y líneas;
- ticket persistido bajo el mismo identificador.

Duplicar esas ventas en un store nuevo crearía dos fuentes de verdad. El diseño será una proyección de lectura sobre cola + tickets + pedidos remotos.

## Alcance

Esta entrega incluye:

- adaptación pura de ventas locales desde la cola;
- combinación y deduplicación con pedidos de Odoo;
- estados visibles;
- subtotal separado de pendientes;
- acceso al ticket local;
- refresco al completar una sincronización;
- compatibilidad con ventas antiguas de la cola.

Quedan fuera:

- sumar pendientes al KPI oficial, corte o liquidación;
- editar líneas de una venta ya encolada;
- borrar automáticamente operaciones con error;
- cambiar las reglas de reintento de la cola.

## Modelo de presentación

La pantalla consumirá un tipo propio, sin falsificar un `GFSalesOrder`:

```ts
type LocalSaleStatus =
  | 'pending'
  | 'syncing'
  | 'retrying'
  | 'needs_attention';

interface SalesListEntry {
  key: string;
  operationId: string;
  origin: 'odoo' | 'local';
  customerName: string;
  amountTotal: number | null;
  kgTotal: number | null;
  createdAtMs: number;
  localStatus?: LocalSaleStatus;
  errorMessage?: string | null;
  remoteOrder?: GFSalesOrder;
}
```

La cola seguirá siendo la fuente de verdad de estados locales. El ticket será la fuente preferida para nombre, total, kilogramos y detalle de líneas. Los campos `_clientCustomerName` y `_clientTotal` del payload serán fallback para ventas legacy o tickets todavía no cargados.

Para un ítem legacy sin ticket ni metadatos:

- `customerName` será `Cliente sin nombre`;
- `amountTotal` y `kgTotal` serán `null`;
- la tarjeta seguirá visible y contará como una venta pendiente;
- su monto no se sumará al subtotal pendiente;
- la UI mostrará `Monto no disponible`, sin inventar cero.

## Adaptación de estados

| Cola | Estado visible |
| --- | --- |
| `pending` | Pendiente de sincronizar |
| `syncing` | Sincronizando |
| `error` | Reintentando |
| `dead` | Requiere atención |

El error más reciente se mostrará en la tarjeta de `error` o `dead`, sin exponer detalles técnicos innecesarios.

Solo se proyectarán ítems `sale_order`. Los eventos de foto, visita, pago, GPS y telemetría no crearán tarjetas de venta.

## Combinación y deduplicación

La clave de conciliación será `operation_id` cuando sea un string no vacío. Para soportar registros históricos que pudieron cambiar mayúsculas, la comparación usará `trim().toLowerCase()` exclusivamente para deduplicar; el valor original se conservará para API, almacenamiento e impresión.

Un pedido remoto con `operation_id` vacío no participa en conciliación. Su clave de presentación será `odoo:<order.id>`, por lo que varios pedidos históricos sin operación permanecen separados. Una venta local siempre usa el `id` no vacío de la cola como clave `local:<operationId>`.

Reglas:

1. construir tarjetas locales desde ítems de venta no confirmados;
2. indexar pedidos remotos por `operation_id`;
3. si ambos existen, gana el pedido remoto;
4. ordenar la lista unificada por fecha descendente;
5. limitar la vista al día local de la pantalla.

Cuando una venta pase a `done`, la pantalla solicitará `sales/summary` y `sales/list`. Mientras la respuesta llega, puede mantener una tarjeta transitoria de actualización. En cuanto Odoo devuelva la operación, la tarjeta remota la reemplaza sin duplicados.

Después de reiniciar, los ítems `done` ya no están en la persistencia de cola. En ese caso la lista remota será la única fuente, lo cual es correcto porque `done` significa que Odoo confirmó la operación.

## Indicadores

Los KPI existentes seguirán usando únicamente `GFSalesSummary`:

- Vendido;
- Pedidos;
- Kilogramos;
- Meta;
- corte y liquidación.

La pantalla añadirá un resumen independiente:

```text
Pendiente de sincronizar: $1,250.00 · 2 ventas
```

Se sumarán los montos conocidos de `pending`, `syncing` y `error`. Todos esos registros cuentan en la cantidad, incluso si el monto es desconocido; la UI indicará cuántos no tienen monto. `dead` se reportará además como operaciones que requieren atención y no se mezclará con el total oficial.

## Navegación y ticket

- Una tarjeta remota construye o abre el ticket desde `GFSalesOrder`, como hoy.
- Una tarjeta local carga el snapshot persistido con la clave `sale-ticket:<operationId>` y navega a `/print/<operationId>`.
- Si el snapshot todavía no está disponible, la tarjeta permanece visible y deshabilita temporalmente la impresión con un mensaje recuperable.
- La reimpresión posterior a sincronización usa el pedido remoto y sus precios definitivos.

## Errores y recuperación

- Un fallo de `sales/list` no elimina las tarjetas locales.
- Una cola vacía no elimina pedidos remotos ya cargados.
- Una tarjeta con `dead` permanece hasta una acción explícita en el flujo de sincronización.
- Los errores de red se muestran de forma no bloqueante si existen datos locales o remotos previos.
- No se marcará una venta como confirmada por inferencia; únicamente el estado `done` o la presencia del pedido remoto cambia su representación.

## Pruebas

1. Adaptación de cada estado de cola.
2. Exclusión de tipos distintos a `sale_order`.
3. Lectura preferente del ticket y fallback al payload.
4. Venta legacy sin ticket ni metadatos conserva tarjeta, cantidad y monto desconocido.
5. Deduplicación exacta y compatible con mayúsculas.
6. Varios pedidos remotos sin `operation_id` conservan claves distintas.
7. El pedido remoto reemplaza la tarjeta local.
8. Orden por fecha y filtro del día local.
9. Pendientes no alteran los KPI oficiales.
10. Resumen pendiente calcula cantidad, monto conocido y registros sin monto.
11. Un error remoto conserva datos locales.
12. Navegación al ticket local y remoto.
13. Una transición a `done` dispara refresco.
14. Suite existente de ventas, cola, rehidratación y tickets.

## Criterios de aceptación

- La venta aparece en Ventas inmediatamente después de encolarse.
- Su tarjeta sobrevive un reinicio mientras siga pendiente o con error.
- El estado de sincronización es visible.
- Nunca aparecen dos tarjetas para el mismo `operation_id` no vacío.
- Pendientes no se suman a indicadores oficiales ni al corte.
- Al confirmarse en Odoo, la tarjeta remota sustituye a la local.
