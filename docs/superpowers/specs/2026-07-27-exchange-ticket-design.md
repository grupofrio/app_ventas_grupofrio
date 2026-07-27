# Ticket de cambio de producto — Diseño

**Fecha:** 2026-07-27  
**Estado:** Aprobado por el usuario

## Objetivo

Generar, al registrar exitosamente un cambio de producto, un ticket sencillo que identifique al cliente y describa los productos entregados y recogidos. El ticket debe poder revisarse dentro de la app, abrirse como PDF e imprimirse en la MP210.

## Alcance

Incluye:

- Crear una evidencia local independiente para cada cambio confirmado.
- Mostrar una pantalla de resultado con vista previa del ticket.
- Abrir/compartir el ticket como PDF térmico de 58 mm.
- Imprimirlo en la MP210 reutilizando el flujo Bluetooth existente.
- Mostrar cliente, folio, fecha, entregas, mermas y notas.

No incluye:

- Cambios al endpoint o contrato backend del cambio.
- Precios, cobro, subtotal o total.
- Historial nuevo de tickets de cambio.
- Cambios al flujo de tickets de venta.

## Flujo de usuario

1. El vendedor captura productos entregados, productos recogidos/merma y notas en `app/exchange/[stopId].tsx`.
2. La app llama al endpoint existente `gf/salesops/exchange/create`.
3. Antes de llamar al backend, la app conserva la clave de idempotencia en una variable local. Solo cuando Odoo responde correctamente, la app construye y guarda un `ExchangeTicketSnapshot` local.
4. La app navega a una ruta nueva de salida del ticket.
5. El vendedor puede revisar el ticket, abrir el PDF o imprimir en la MP210.
6. Si el ticket no se puede guardar localmente después de que el cambio fue aceptado, la app informa que el cambio sí quedó registrado y evita sugerir un reintento.

## Modelo de datos

Se agregará un modelo independiente del ticket de venta:

```ts
interface ExchangeTicketLine {
  productId: number;
  productName: string;
  quantity: number;
}

interface ExchangeTicketSnapshot {
  snapshotId: string;
  folio: string;
  customerName: string;
  createdAt: string;
  deliveryLines: ExchangeTicketLine[];
  mermaLines: ExchangeTicketLine[];
  notes: string;
}
```

`createdAt` se generará en la app con `new Date().toISOString()` después de la respuesta exitosa; la vista HTML y la vista previa lo formatearán en la zona local del dispositivo (`es-MX`).

`snapshotId` será siempre la clave de idempotencia conservada antes de la llamada y será la única identidad de almacenamiento/ruta. El `folio` visible preferirá `response.data.exchange_name`, después `response.data.exchange_id` y finalmente `CAMBIO-<primeros 8 caracteres de snapshotId>`. El almacenamiento usará `exchange-ticket:<snapshotId>` y la ruta recibirá `snapshotId`, no el folio visible.

Los nombres se toman del catálogo local mediante `productMap`; si un producto ya no está disponible en el catálogo se usará `Producto <id>`. El cliente usa `currentStop.customer_name` y cae en `Cliente sin nombre` si viene vacío. Las cantidades son las cantidades positivas ya validadas y enviadas al backend.

## Ticket y presentación

La vista previa y el PDF mostrarán:

- Grupo Frío y título `TICKET DE CAMBIO`.
- Folio, fecha y cliente.
- Sección `PRODUCTO ENTREGADO` cuando haya entregas.
- Sección `PRODUCTO RECOGIDO / MERMA` cuando haya mermas.
- Notas solo cuando tengan contenido.
- Mensaje final `Cambio registrado correctamente`.

Las secciones vacías se omiten. No se mostrarán precios ni información de pago.

El PDF reutilizará `expo-print` y `expo-sharing`, con ancho de 58 mm. La pantalla de salida reutilizará la preparación de permisos, selección de impresora, estados de envío y reimpresión segura de la MP210.

El contrato del módulo térmico se ampliará de forma compatible, conservando `schemaVersion: 1` y el comportamiento actual de venta por defecto:

- `ticketKind?: 'sale' | 'exchange'`, con `sale` como valor por defecto para tickets existentes.
- `exchangeNotes?: string` para notas del cambio.
- `sectionLabel?: string` en cada línea para distinguir `ENTREGA` y `MERMA`.

El renderer nativo tendrá una rama específica para `exchange`: imprimirá logo, título, folio, fecha, cliente, secciones, cantidades, notas y pie; no imprimirá pago, subtotal, kilogramos ni total. Los campos comunes que el contrato actual exige seguirán presentes internamente con valores neutros para que la validación existente sea compatible, pero no se dibujarán en la rama de cambio. La rama `sale` y sus pruebas actuales no cambian.

El payload térmico exacto para un cambio será:

```ts
{
  schemaVersion: 1,
  ticketKind: 'exchange',
  branding: {
    logoPngBase64: SALE_TICKET_BRANDING.logoPngBase64,
    logoVersion: SALE_TICKET_BRANDING.version,
    legalName: SALE_TICKET_BRANDING.legalName,
    rfcLabel: SALE_TICKET_BRANDING.rfcLabel,
    title: 'TICKET DE CAMBIO',
    footer: SALE_TICKET_BRANDING.footer,
  },
  folio,
  formattedDate,
  customerName,
  sellerName: '—',
  paymentLabel: 'No aplica',
  lines: [
    {
      productId,
      productName,
      quantityAndUnitPrice: `Cantidad: ${formatQuantity(quantity)}`,
      lineTotal: '—',
      sectionLabel: 'ENTREGA' | 'MERMA',
    },
  ],
  subtotal: '—',
  totalKg: '—',
  total: 'No aplica',
  exchangeNotes: notes,
}
```

En el tipo `exchange`, `sectionLabel` es obligatorio para cada línea y solo puede ser `ENTREGA` o `MERMA`; `lineTotal` y los campos neutros son obligatorios por compatibilidad del record actual, pero se ignoran en el layout de cambio. El tipo desconocido se rechaza y el tipo ausente se interpreta como `sale`.

`formatQuantity` se reutilizará desde `src/services/saleTicketFormatting.ts`: enteros sin decimales y cantidades fraccionarias con dos decimales. Las notas vacías se normalizan a `''` y el snapshot faltante en la pantalla de salida muestra `Ticket no encontrado` junto con el `snapshotId`, sin intentar imprimir.

## Componentes y responsabilidades

- `src/services/exchangeTicket.ts`: tipos, construcción del snapshot y generación HTML escapado.
- `src/services/exchangeTicketStorage.ts`: guardar y cargar snapshots con almacenamiento local.
- `src/services/exchangeTicketPdf.ts`: crear y abrir PDFs con la infraestructura Expo existente.
- `src/services/exchangeThermalTicketDocument.ts`: adaptar el snapshot al documento térmico extendido con `ticketKind: 'exchange'`.
- `modules/thermal-printer/...`: ampliar el record, modelo y layout nativos para el tipo de ticket de cambio, manteniendo venta como default.
- `app/print-exchange/[snapshotId].tsx`: cargar snapshot, mostrar vista previa y exponer PDF/MP210.
- `app/exchange/[stopId].tsx`: construir/guardar snapshot tras el éxito y navegar a la nueva ruta.
- `tests/`: pruebas unitarias del modelo/HTML y wiring del flujo.

## Errores y seguridad del flujo

- Una respuesta fallida del backend no crea ticket.
- Un error posterior de almacenamiento local no se presenta como error del cambio; se informa que el cambio fue registrado y que el ticket no pudo prepararse.
- Si `storeSaveStrict` falla, la app no permanece en el formulario ni navega a una ruta sin snapshot: muestra una alerta que indica que el cambio sí se registró y que no debe repetirse, y vuelve al check-in con el mensaje del backend. No se ofrece imprimir porque no existe una evidencia local cargable.
- El guardado del ticket usará `storeSaveStrict`, que ya existe en `src/persistence/storage.ts`, para detectar el error local en vez de absorberlo.
- El HTML escapa cliente, productos y notas antes de insertarlos.
- La impresión mantiene la compuerta de una sola operación y la confirmación de reimpresión cuando el envío pudo quedar incompleto.
- Si no hay visor o compartir disponible, el usuario conserva la opción de imprimir.

## Verificación

- Pruebas unitarias de snapshot: cliente, folio, cantidades, notas y secciones vacías.
- Pruebas de HTML: contenido visible y escape de texto.
- Pruebas Android del renderer: el tipo `exchange` no imprime pago/subtotal/total y la venta existente conserva su salida.
- Pruebas de fallback del folio usando la clave de idempotencia conservada.
- Prueba de fallo de guardado estricto después de una respuesta exitosa.
- Pruebas del payload térmico: `sectionLabel` válido por línea, campos neutros presentes y tipo desconocido rechazado.
- Prueba de wiring: el éxito del cambio guarda el snapshot y navega a la ruta de salida.
- `npm test` para la suite completa.
- `npm run typecheck` para validar TypeScript.
