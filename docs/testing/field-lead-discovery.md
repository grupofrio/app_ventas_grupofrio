# Prospectos en visita especial — staging

## Comportamiento

- Nuevo Prospecto confirma primero la persistencia local; el mensaje «registrado en Odoo» depende del estado `done`, que exige un identificador positivo en la respuesta de creación.
- Un guardado local fallido conserva operación y formulario para reintentar. Se bloquea salir hasta confirmar persistencia. No hay alta directa que omita la cola.
- Visita especial combina clientes del bundle con prospectos consultados online mediante `/employee/lead/search`. El Bearer determina compañía y plaza; no hay RPC administrativo ni dominios enviados por el cliente.
- Los prospectos requieren inicio de visita confirmado. Actualización/conversión usan `offroute_visit_id`; la parada negativa permanece como identidad de navegación local.
- Odoo liga una parada de prospecto al iniciar la visita, reutiliza esa asociación para conversión idempotente y venta, y cierra la parada con resultado explícito. Los datos en cola pueden llegar después del cierre.
- Al refrescar se concilia por visita para evitar duplicar parada real y borrador local. Teléfono y coordenadas confirmados se conservan para habilitar conversión.

## Dependencia de despliegue

Backend `grupofrio/gf`, rama `codex/fix-field-lead-discovery` hacia `staging280826`; actualizar `gf_logistics_ops` a 18.0.1.26.5 (campos nuevos). Después integrar la app en `codex/mastermind-appventas-staging` y generar APK con Expo. El PR de horario CDMX es independiente.

## Prueba en celular

1. Con ruta iniciada y conexión, crear prospecto con teléfono y ubicación. Esperar registro confirmado.
2. Buscarlo por nombre en Visita especial; incluir el caso existente PROSPECTO 1. No debe requerir preparar otra vez la ruta.
3. Abrir, guardar datos y convertir; validar compañía/plaza, canal y un solo cliente. Reintentar la misma conversión sin duplicados.
4. Refrescar/reabrir durante la visita: solo una parada. Hacer venta y verificar vínculo con esa visita.
5. Abrir otro prospecto, guardar datos sin señal, cerrar y reconectar: sincronizar datos y cierre sin perderlos.
6. Sin señal, buscar clientes guardados; mostrar que la consulta de prospectos requiere conexión.
7. Odoo: empleado de otra plaza no debe listar ni abrir el prospecto; inicio sin ruta debe fallar sin crear visita huérfana.

Pruebas locales: suite Node completa y TypeScript; backend pruebas unitarias/contrato sin Odoo. Los TransactionCase añadidos requieren CI/Odoo y la validación E2E requiere nuevo APK. No se ha convertido el prospecto del usuario como parte del diagnóstico.

## Alta seguida de venta

- Dirección escrita y GPS son independientes. El botón «Estoy en el negocio» obtiene una lectura nueva (máximo 2 minutos y 100 metros de precisión); se permite guardar solo dirección sin atribuir coordenadas del empleado a otro lugar.
- Tras confirmar el alta se ofrece registrar venta. Aceptar prepara contacto y visita en una sola operación recuperable, conserva el lead vinculado y abre el carrito con la lista de precios del servidor. No crea un pedido por aceptar el aviso.
- Teléfono, canal y GPS faltantes se corrigen sobre el mismo lead; la corrección conserva su UUID ante respuestas perdidas. La conversión requiere conexión.
- Una operación ambigua conserva la intención de venta incluso si otra visita impide reanudarla temporalmente. La apertura local persiste parada y visita antes de descartar la recuperación y no reinicia un carrito ya abierto.

### Casos adicionales en staging

1. Alta con dirección y GPS confirmado → aceptar venta → verificar un solo contacto, lead vinculado, visita y precios; completar pedido usando el flujo existente.
2. Rechazar venta → conserva solo prospecto; localizarlo después en Visita especial.
3. Alta sin teléfono/GPS → aceptar → completar datos del mismo prospecto → reintentar sin otra alta.
4. Cortar conexión al confirmar alta y al preparar venta; cerrar/reabrir y verificar que las operaciones se recuperen sin duplicados.
5. Tras respuesta perdida, continuar otra visita y volver: debe pedir terminarla sin permitir descartar la operación ambigua; luego recuperar la original.
6. Denegar GPS o estar lejos del negocio → guardar dirección sin GPS; no inventar coordenadas ni habilitar conversión hasta completarlas.

Validación local del alcance ampliado: 886 pruebas de app y TypeScript; 369 pruebas de backend y 56 subpruebas. Odoo TransactionCase y E2E del nuevo flujo pendientes.
