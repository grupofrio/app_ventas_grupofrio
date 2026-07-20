# Ticket PDF al ras en papel de 58 mm - Diseño

**Fecha:** 2026-07-20

**Estado:** Aprobado por el usuario

## Objetivo

Eliminar el espacio lateral agregado por la plantilla del ticket para que el contenido del PDF use los 58 mm completos del papel y llegue al ras de ambos lados.

## Contexto actual

El PDF ya se genera con una página de 58 mm y márgenes de impresión en cero:

- `src/services/saleTicket.ts` declara `@page { size: 58mm auto; margin: 0; }` y `body { width: 58mm; }`.
- `src/services/saleTicketPdf.ts` envía márgenes superiores, inferiores y laterales en cero a `expo-print`.
- La plantilla HTML agrega `padding: 4mm 3mm` al `body`; esos 3 mm por lado reducen el ancho útil del contenido a 52 mm.

## Diseño aprobado

Cambiar únicamente el relleno del `body` de la plantilla HTML a `padding: 4mm 0`. Se conservan los 4 mm verticales y se eliminan los 3 mm laterales.

El ancho de página, la altura dinámica, el logo, la tipografía, los divisores, el contenido fiscal, la leyenda de crédito y la vista previa de la aplicación no cambian.

## Comportamiento esperado

- El PDF conserva un ancho físico de 58 mm.
- La página y `expo-print` continúan sin márgenes.
- El contenido HTML no agrega espacio a izquierda ni derecha.
- Los bordes laterales del ticket quedan al ras del papel, sujetos únicamente a las limitaciones físicas o configuración de la impresora.
- Los márgenes verticales permanecen en 4 mm.

## Pruebas

- Agregar una aserción unitaria sobre el HTML generado que exija `padding: 4mm 0`.
- Mantener las aserciones existentes de `size: 58mm auto` y `width: 58mm`.
- Ejecutar las pruebas específicas del ticket y la suite completa del proyecto.
- Generar y renderizar un PDF de muestra, si el runtime local permite ejecutar `expo-print`; si no, documentar la limitación y validar el HTML como evidencia automatizada.

## Fuera de alcance

- Cambiar el ancho del papel o soportar formatos distintos de 58 mm.
- Modificar datos, importes, razón social, RFC, pagaré, logo o tipografía.
- Cambiar la vista previa dentro de la aplicación.
- Compensar márgenes físicos impuestos por un modelo específico de impresora.
