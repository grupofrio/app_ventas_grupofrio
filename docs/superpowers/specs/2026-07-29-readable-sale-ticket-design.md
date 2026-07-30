# Diseño: ticket de venta legible para MP210 y PDF

**Fecha:** 2026-07-29

**Estado:** Diseño aprobado por el usuario

## Objetivo

Hacer que el ticket de venta sea legible para cualquier persona, priorizando la impresión térmica en la MP210. La tipografía principal pasará de 20 px a 32 px en el cuerpo y de 28 px a 44 px en el total, usará una sans-serif neutral para letras y números, y permitirá que el ticket sea más largo cuando el contenido lo requiera.

El PDF debe conservar la misma jerarquía visual y contenido, aunque la MP210 es el criterio principal de aceptación.

## Alcance

Incluye:

- cambiar la fuente térmica de `Space Mono` a la sans-serif neutral del sistema Android;
- aumentar tamaños, interlineado y separación de secciones en la MP210;
- reorganizar los datos para evitar filas comprimidas;
- aumentar la legibilidad del PDF, manteniendo el ancho de 58 mm y permitiendo mayor altura;
- conservar método de pago, nota de crédito, totales, acentos, nombres largos y datos fiscales;
- actualizar las pruebas de layout, wrapping y markup.

No incluye:

- cambiar el ancho físico de la MP210, que permanece en 384 puntos;
- cambiar el modelo de datos del ticket;
- cambiar reglas de precios, pagos o sincronización;
- eliminar información fiscal o legal.

## Diseño visual aprobado

### Prioridad de lectura

La jerarquía, de mayor a menor prioridad, será:

1. Cliente.
2. Productos, cantidades e importes.
3. Forma de pago.
4. Total.
5. Folio, fecha y vendedor.
6. Razón social, RFC, pie y nota legal.

### Impresión MP210

La salida seguirá siendo un bitmap monocromático de 384 px de ancho y como máximo 6,000 px de alto. Se cambiará el proveedor de tipografías de `ThermalTicketRenderer` para usar `sans-serif` y su variante negrita del sistema Android. No se cambiará el contrato nativo del documento térmico ni el protocolo Bluetooth.

La escala objetivo para el layout térmico es (todos los valores son píxeles del bitmap de 384 px):

- cuerpo principal: 32 px con interlineado de 40 px;
- texto secundario: 26 px con interlineado de 34 px;
- total y encabezados de importe: 44 px con interlineado de 54 px;
- mínimo para importes que deban ajustarse al ancho: 24 px;
- campos fiscales y pie: 26 px / 34 px; la separación entre bloques será de 12 px y la separación interna entre renglones de 6 px.

Los datos principales usarán bloques verticales: etiqueta en 26 px negrita y valor en 32 px normal. Si un valor cabe en una sola línea, podrá permanecer en la misma línea; si no, la etiqueta y el valor se apilarán sin reducir el cuerpo por debajo de 24 px.

Cada producto ocupará todo el ancho disponible. El primer renglón será el nombre en 32 px negrita. El segundo renglón intentará colocar `quantityAndUnitPrice` a la izquierda y `lineTotal` a la derecha, con 12 px de separación. El importe se medirá primero en 44 px y se reducirá de 2 en 2 px hasta 24 px mientras no quepa; si no caben ambos textos, `quantityAndUnitPrice` se renderizará primero a todo el ancho en 26 px y el importe se renderizará debajo, alineado a la derecha, aplicando la misma reducción. Cada texto se envolverá primero por palabras y luego por puntos de código; nunca se truncará. No habrá una tercera columna comprimida.

Los totales quedarán después de un divisor; subtotal y kilogramos usarán 32 px y el total usará 44 px negrita con 54 px de interlineado y 12 px de separación superior.

El motor de wrapping seguirá partiendo primero por palabras y después por puntos de código cuando una palabra sea demasiado larga. La altura seguirá creciendo hasta el límite seguro existente de 6,000 px; si se excede, se conservará el error explícito de ticket demasiado grande.

### PDF y vista previa

El PDF conservará el ancho de 58 mm y usará `Arial` como fuente primaria, con `Helvetica, sans-serif` únicamente como fallback del WebView de Expo Print; no se usará `monospace`. La fuente efectiva se verificará en el HTML generado comprobando que la primera familia declarada sea `Arial` y que no exista `monospace`; Expo Print no ofrece una opción de incrustación de fuentes para este flujo. La tabla de tamaños será: cuerpo 14 px / 19 px, etiquetas y metadatos 12 px / 17 px, nombres de producto 15 px / 20 px, importes 15 px / 20 px y total 20 px / 26 px. Los bloques tendrán 8 px de separación y los productos repetirán la misma estructura de dos renglones: nombre arriba, cantidad/precio a la izquierda e importe a la derecha. Los tamaños son CSS px del WebView; la API de Expo Print recibe el ancho y alto de página en puntos PDF, y la implementación mantendrá esa conversión en los parámetros existentes de `printToFileAsync`.

La vista previa de `app/print/[orderId].tsx` reflejará la misma jerarquía con valores equivalentes: cuerpo 16 px / 22 px, etiquetas y metadatos 14 px / 19 px, nombres 16 px / 21 px, importes 16 px / 22 px y total 22 px / 28 px. El PDF podrá crecer en altura según el número de líneas y la nota de crédito. En PDF y vista previa, los nombres de producto, nombres de cliente, textos de pago y notas usarán wrapping por palabras y `break-word`/equivalente; nunca se recortarán ni se ocultarán con clipping.

Para el PDF, `getTicketHeight` calculará una reserva determinista: altura base de 330 puntos + 58 puntos por línea + 18 puntos por cada renglón adicional estimado. El estimado será `max(1, ceil(texto.length / 26))` para el nombre de producto, cliente, vendedor y nota de crédito, y se sumará el exceso sobre un renglón de cada campo. Se añadirán 90 puntos por la nota de crédito. La altura solicitada nunca será menor que esa reserva; la salida seguirá usando ancho de 164 puntos (58 mm a 72 PPI) y márgenes cero.

La equivalencia entre las tres salidas queda fijada así:

| Contenido | MP210 | PDF | Vista previa |
| --- | --- | --- | --- |
| Cuerpo/valor | 32 / 40 px | 14 / 19 px | 16 / 22 px |
| Etiqueta/secundario | 26 / 34 px | 12 / 17 px | 14 / 19 px |
| Nombre de producto | 32 / 40 px, negrita | 15 / 20 px, negrita | 16 / 21 px, negrita |
| Total | 44 / 54 px, negrita | 20 / 26 px, negrita | 22 / 28 px, negrita |
| Separación de bloques | 12 px | 8 px | 12 px |

## Flujo de datos y compatibilidad

PDF, vista previa y MP210 continuarán partiendo del mismo `SaleTicketSnapshot` y del mismo `ThermalTicketDocument` para la salida térmica. El cambio será exclusivamente de presentación y layout.

Se conservarán sin transformación adicional:

- nombres de cliente, vendedor y producto, incluidos acentos;
- método de pago y etiqueta de Crédito;
- nota de pagaré para crédito;
- cantidades, precios, subtotal, kilogramos y total;
- folio, fecha CDMX, razón social y RFC.

## Pruebas y criterios de aceptación

### MP210

- El ancho de layout permanece en 384 px y la altura máxima en 6,000 px.
- La fuente utilizada por el renderer es sans-serif del sistema y tiene variantes normal/negrita.
- Las constantes de tamaño e interlineado reflejan la nueva escala legible.
- Las filas no se superponen y todos los comandos quedan dentro de la altura final.
- Los nombres largos, clientes largos y notas de crédito se envuelven sin recortarse; los textos sin espacios se parten por puntos de código.
- Los importes se mantienen alineados y no bajan del mínimo definido.
- El ticket de crédito es más alto que el de efectivo y conserva la nota legal.
- El ticket sigue siendo válido para el contrato nativo: `schemaVersion`, branding, folio, fecha, cliente, vendedor, pago, líneas, subtotal, kilogramos, total y `creditNote` conservan sus nombres, tipos y valores.
- La salida conserva el `MonochromeRaster` de bits empacados, el ancho 384 y la capacidad de imprimir mediante el mismo comando Bluetooth existente. El renderer puede seguir usando un bitmap intermedio `ARGB_8888`; `ALPHA_8` no forma parte del contrato actual.

### PDF y app

- El HTML no usa `monospace` como fuente principal.
- El PDF conserva ancho 58 mm y márgenes laterales cero.
- El cuerpo térmico es 1.6 veces el tamaño anterior (32/20), el total es al menos 1.57 veces el anterior (44/28), y la salida PDF declara las medidas de la tabla sin `monospace`.
- La vista previa mantiene el contenido completo y el botón de impresión térmica usa el mismo documento.
- Casos mínimos: ticket en efectivo, ticket a crédito con nota, nombre de cliente largo, producto con nombre largo o token sin espacios y ticket que alcanza el límite de 6,000 px.
- Las pruebas existentes de branding, crédito, fecha CDMX, wrapping y typecheck siguen pasando.

Las pruebas deberán comprobar explícitamente que: (a) `buildSaleTicketHtml` declara `Arial` como primera familia, no contiene `monospace`, incluye los tamaños de la tabla, permite wrapping y conserva ancho 58 mm/márgenes cero; (b) el documento térmico conserva una comparación profunda del snapshot de entrada, incluidos branding (`logoPngBase64`, versión, razón social, RFC, título y pie), folio, fecha, cliente, vendedor, pago, líneas, subtotal, kilogramos, total y `creditNote`; (c) el renderer usa `Typeface.create("sans-serif", ...)`, entrega `MonochromeRaster` empacado de ancho 384 y conserva el límite de 6,000 px; y (d) PDF y vista previa contienen exactamente esos mismos campos y valores, incluyendo crédito/efectivo, nota legal, wrapping de nombres largos y crecimiento de altura.

## Archivos previstos

- `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt`
- `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketRenderer.kt`
- `app/print/[orderId].tsx`
- `src/services/saleTicket.ts`
- `src/services/saleTicketPdf.ts`
- `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketLayoutTest.kt`
- `tests/saleTicket.test.ts`
- `tests/thermalTicketDocument.test.ts`
- `tests/saleTicketWiring.test.mjs`
