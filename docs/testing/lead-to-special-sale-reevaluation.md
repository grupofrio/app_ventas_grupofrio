# Reevaluación: alta de prospecto y venta inmediata

Estado: flujo implementado en PR109 (app) y PR213 (backend). Validado con pruebas locales; ambos permanecen en borrador hasta ejecutar los casos de Odoo y la aceptación en celular.

## Hallazgos que motivaron el cambio

- Nuevo Prospecto permite escribir dirección y manda latitude/longitude del store del empleado. No obtiene una lectura nueva ni confirma que esas coordenadas correspondan al negocio.
- La dirección se guarda como texto. La app no tiene geocodificación de direcciones implementada.
- La cola descarta la respuesta de creación salvo la confirmación de éxito. El flujo directo necesita conservar el id del lead; buscar por nombre no identifica un registro de forma inequívoca.
- La conversión segura existente necesita una visita/parada autorizada. La app puede preparar esa asociación sin obligar al vendedor a buscar de nuevo al prospecto.

## Flujo implementado

1. Capturar nombre, teléfono, giro y dirección del cliente.
2. Mostrar «Usar mi ubicación como ubicación del cliente». Si el vendedor está en el negocio, obtener una lectura nueva del GPS y mostrar su estado antes de guardar; no sustituir coordenadas faltantes por cero ni usar silenciosamente la ubicación de otra parada.
3. Si el vendedor está en otro lugar, conservar la dirección escrita y dejar la ubicación pendiente. Convertir una dirección a coordenadas requiere un paso adicional de búsqueda/confirmación en mapa, todavía no disponible. No usar el GPS del empleado como ubicación de un negocio distante.
4. Guardar el prospecto en la cola y esperar confirmación de Odoo, conservando lead_id e identidad de operación.
5. Mostrar «Prospecto registrado. ¿Quieres registrar una venta ahora?» con «Registrar venta» y «Por ahora no».
6. «Por ahora no» conserva el lead, sin crear cliente ni visita adicional.
7. «Registrar venta» valida datos necesarios, prepara la visita especial autorizada, convierte/vincula el contacto de Odoo y abre el carrito de esa misma visita con los precios del cliente. No exige volver a buscar ni capturar los datos otra vez.
8. El pedido queda ligado a cliente, empleado, compañía/plaza y visita especial. El lead permanece vinculado para trazabilidad; no se elimina al crear el contacto.

## Recuperación y límites

- En esta primera versión, alta confirmada + conversión requieren conexión. Sin señal se guarda el prospecto pendiente; no se anuncia un contacto o venta creados en el servidor.
- Conservar identificadores de lead, visita y conversión para reanudar después de cerrar la app o perder conexión.
- Inicio de visita/conversión deben ser idempotentes también ante doble toque y respuesta perdida. La confirmación de venta sigue el flujo existente, no se emite un pedido automáticamente por aceptar el popup.
- Si Odoo detecta posible cliente duplicado, conservar el lead y mostrar revisión, sin crear un segundo contacto.
- Si faltan teléfono, canal comercial o ubicación exigidos para convertir, llevar al dato faltante conservando el formulario y la intención de venta.

## Validación de aceptación

- Alta con GPS nuevo en el negocio → popup → cliente ligado → una visita especial → carrito con precios → pedido asociado.
- «Por ahora no» → solo lead, encontrable después en Visita especial.
- GPS viejo/denegado/no disponible → mensaje claro; ninguna coordenada inventada.
- Alta desde otra ubicación → dirección conservada, sin atribuir GPS remoto al cliente.
- Sin conexión → pendiente real; recuperar conexión confirma una sola alta.
- Doble toque/reinicio/respuesta perdida → sin duplicar lead, contacto, visita ni pedido.
