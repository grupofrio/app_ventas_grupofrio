# Folio de Odoo y vendedor en tickets de venta

**Fecha:** 2026-07-24
**Estado:** Aprobado por el usuario; pendiente de revisión de especificación

## Objetivo

Los tickets reales de venta deben mostrar como folio principal la referencia
autoritativa de Odoo (`sale.order.name`, por ejemplo `S00042`). El identificador
generado por el celular seguirá existiendo para idempotencia y almacenamiento,
pero no debe presentarse como si fuera el folio definitivo de Odoo.

La ausencia temporal del folio de Odoo no bloqueará la impresión. Tanto la
MP210 como el PDF deben seguir disponibles durante una venta offline o mientras
la sincronización está pendiente.

Al reabrir un ticket desde la lista de Ventas, el vendedor debe provenir de la
venta autoritativa de Odoo. No se sustituirá silenciosamente con el empleado que
está conectado en ese momento.

## Comportamiento visible

### Cuando ya existe folio de Odoo

La vista previa, el PDF y el ticket térmico mostrarán:

```text
Folio Odoo: S00042
```

La referencia local se ocultará para evitar ruido y confusión.

### Cuando aún no existe folio de Odoo

La vista previa, el PDF y el ticket térmico mostrarán:

```text
Folio Odoo: Pendiente por sincronizar
Referencia local: <identificador generado por el celular>
```

Los botones `Imprimir en MP210` y `Abrir PDF` permanecerán disponibles. La
referencia local se identifica explícitamente como tal; nunca se rotulará como
folio de Odoo.

### Después de sincronizar

Cuando Odoo confirme la venta y devuelva `sale.order.name`, el comprobante local
se promoverá al folio oficial. Las impresiones posteriores mostrarán únicamente
el folio de Odoo.

## Modelo de datos

`SaleTicketSnapshot` separará dos conceptos:

- `saleId`: identificador técnico estable del celular. Continúa siendo la llave
  de almacenamiento local, la referencia de navegación y el identificador de
  idempotencia.
- `odooFolio`: `string | null`. Contiene exclusivamente una referencia no vacía
  obtenida de `sale.order.name`.

Los snapshots creados antes de enviar la venta tendrán `odooFolio: null`. Los
snapshots construidos desde una fila autoritativa de ventas usarán
`order.name.trim()` cuando sea no vacío.

Los snapshots persistidos por versiones anteriores no tienen `odooFolio`. Al
cargarlos se migrarán en memoria a `null` y se mostrarán como pendientes, sin
romper la impresión.

La persistencia será monotónica:

- un valor `null` puede promoverse a un folio no vacío;
- un guardado posterior con `null` no puede borrar un folio ya conocido;
- un nuevo folio no vacío proveniente de Odoo puede reemplazar el anterior.

Esto evita que una recuperación offline antigua vuelva a degradar un ticket ya
sincronizado.

## Fuente autoritativa y contrato de creación del folio

El backend actual ya incluye en la respuesta de
`POST /gf/logistics/api/employee/sales/create`:

```json
{
  "ok": true,
  "data": {
    "success": true,
    "order_id": 42,
    "operation_id": "identificador-local",
    "name": "S00042"
  }
}
```

El endpoint de creación no requiere cambio backend. El frontend dejará de
convertir el resultado a un booleano y conservará el resultado validado.
`data.name` deberá ser una cadena no vacía para que una respuesta de creación se
considere completa.

La misma regla se aplica a respuestas idempotentes con `duplicate: true`,
porque el serializador backend devuelve el mismo `order.name`.

## Vendedor autoritativo al reabrir desde Ventas

El problema actual no está en la impresión inmediata: el snapshot creado en el
teléfono ya guarda el nombre del vendedor autenticado. El defecto aparece al
abrir un ticket desde Ventas. El frontend espera `employee_name`, pero
`sale.order._serialize_kold_sales_order()` no lo incluye y el ticket cae en
`Vendedor no especificado`.

El backend agregará `employee_name` a cada fila de
`POST /gf/logistics/api/employee/sales/list`. La resolución será:

1. `sale.order.x_kold_employee_id`;
2. `sale.order.employee_id`, si el campo existe;
3. `sale.order.gf_route_plan_id.salesperson_employee_id`, o el plan ligado a la
   parada si el campo directo no está disponible;
4. el chofer del mismo plan;
5. cadena vacía solamente si ninguna fuente existe.

El orden privilegia el empleado capturado en la venta y usa la asignación de
ruta solo para registros históricos incompletos. El frontend normaliza la
cadena vacía al fallback existente `Vendedor no especificado`; nunca usa al
usuario actualmente conectado para atribuir una venta histórica.

La respuesta de creación de venta no necesita ampliar su contrato con el
vendedor: la impresión inmediata conserva el nombre capturado en el snapshot
local. El cambio backend es aditivo y se limita al listado.

## Flujo online

1. La app crea el snapshot local con `saleId = operationId` y
   `odooFolio = null`.
2. `createSale` valida y devuelve el resultado de Odoo.
3. La pantalla promueve el snapshot con `odooFolio = result.name`.
4. El snapshot enriquecido se guarda antes de abrir el comprobante.
5. La vista previa, el PDF y la MP210 muestran el folio Odoo.

Si la venta se confirmó pero falla el guardado local, se conserva el manejo
actual de “venta confirmada con aviso”; no se inventa ni se sustituye el folio.

## Flujo offline y sincronización

1. La venta se guarda y puede imprimirse con el estado pendiente y la referencia
   local.
2. El elemento `sale_order` de la cola llama al mismo `createSale`.
3. Al recibir el resultado validado, actualiza el snapshot almacenado bajo el
   `operationId` con `result.name`.
4. Solo después de persistir esa promoción, el elemento se marca como
   sincronizado.

Si la promoción local falla, el elemento queda reintentable. El reintento es
seguro: Odoo encuentra la venta mediante `operation_id`, responde
`duplicate: true` con el mismo `name` y la app vuelve a intentar la persistencia.
Así no se crean pedidos duplicados ni se marca la sincronización como completa
dejando silenciosamente un ticket desactualizado.

Si el snapshot ya no existe, la ausencia confirmada no bloqueará para siempre
una venta que Odoo ya confirmó: se registra el diagnóstico y el elemento puede
marcarse como sincronizado. Al abrir posteriormente el pedido desde la lista de
Ventas, la app reconstruirá el ticket con los datos autoritativos. Esta excepción
aplica solo a un resultado de carga `null`; un error real de lectura o escritura
local sí permanece reintentable.

## Reapertura desde la lista de ventas

La lista diaria ya recibe `order.name`. Al abrir un pedido:

- si existe snapshot local, se conservan sus líneas y datos de impresión, pero
  se promueve o actualiza `odooFolio` con la referencia de Odoo y se reemplaza
  `sellerName` cuando `employee_name` sea no vacío;
- si no existe snapshot local, se construye uno desde la fila autoritativa;
- el guardado se realiza antes de navegar a la pantalla del ticket.

Esto corrige tickets antiguos que todavía contienen solamente la referencia
local y tickets reconstruidos que hoy muestran `Vendedor no especificado`.

Una pantalla de ticket que ya está abierta no se suscribirá en vivo a cambios
de la cola. La promoción será visible al volver a abrir el ticket o al abrirlo
desde Ventas. Esta decisión evita introducir sondeo o un bus de eventos solo
para actualizar dos renglones; la impresión abierta sigue disponible con su
referencia local durante ese intervalo.

## Renderizado compartido

La decisión de presentación se centralizará para que vista previa, PDF y MP210
no diverjan.

El documento térmico mantendrá `folio` como el valor visible:

- folio Odoo cuando existe;
- `Pendiente por sincronizar` cuando no existe.

Además admitirá `localReference` únicamente en el estado pendiente. El
renderizador Android rotulará las filas como `FOLIO ODOO` y `REFERENCIA LOCAL`.
Cuando existe folio de Odoo, `localReference` no se enviará ni se dibujará.

El PDF aplicará las mismas etiquetas y la vista previa mostrará el mismo
contenido sin anteponer `#`.

## Validación y seguridad

- Los folios se recortan con `trim()` y las cadenas vacías se tratan como
  ausentes.
- Los datos del ticket continúan escapándose al generar HTML.
- El `operationId` nunca se sustituye por el folio Odoo como llave local.
- El cambio no modifica idempotencia, creación de ventas, stock, pagos ni
  conciliación.
- No se crea un endpoint nuevo ni se consulta Odoo al momento de imprimir.
- El campo `employee_name` del listado es informativo y no permite al cliente
  seleccionar o suplantar al vendedor.

## Pruebas

La implementación seguirá TDD y cubrirá:

1. validación y retorno de `data.name` para creación nueva y duplicada;
2. rechazo sanitizado de respuestas sin `name` válido;
3. snapshots locales pendientes y snapshots construidos desde Odoo;
4. migración de snapshots antiguos sin `odooFolio`;
5. persistencia monotónica y promoción después de sincronizar;
6. HTML/PDF con folio Odoo y con estado pendiente más referencia local;
7. documento térmico equivalente en ambos estados;
8. renderizado Kotlin de `FOLIO ODOO` y `REFERENCIA LOCAL`;
9. vista previa equivalente y botones de impresión siempre disponibles;
10. reapertura desde Ventas que actualiza un snapshot existente;
11. serialización backend de `employee_name` desde cada nivel de la jerarquía,
    priorizando `x_kold_employee_id`;
12. normalización frontend del vendedor recibido al reconstruir el ticket;
13. cobertura explícita de snapshot ausente durante promoción y del snapshot
    que permanece visible mientras la pantalla ya está abierta;
14. regresión completa de JavaScript, TypeScript, pruebas Odoo y pruebas Android
    del módulo térmico.

## Fuera de alcance

- Cambiar la secuencia o formato de `sale.order.name` en Odoo.
- Mostrar simultáneamente folio Odoo y referencia local después de sincronizar.
- Bloquear impresión o PDF por falta de conexión.
- Consultar un endpoint adicional al abrir cada ticket.
- Alterar el contenido fiscal, precios, productos o forma de pago del ticket.
- Reasignar el vendedor de una venta o inferirlo desde el usuario móvil actual.
