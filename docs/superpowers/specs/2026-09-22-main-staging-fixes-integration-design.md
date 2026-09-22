# Integración de correcciones operativas de staging a main

## Objetivo

Llevar a `main` cuatro correcciones ya desarrolladas y revisadas en staging sin incorporar configuración, identidad visual, endpoints ni controles exclusivos de ese ambiente. El resultado debe conservar el arreglo de fecha operativa de México del PR #111 y producir una base verificable para un APK de producción.

## Alcance

La integración incluye únicamente:

1. La parte pendiente del PR #104: publicar el marcador local de ruta iniciada solo después de guardarlo correctamente en almacenamiento cifrado.
2. PR #106: precargar precios para cada combinación cliente/lista de precios usada por las paradas, de modo que la primera venta sin señal tenga el precio correcto.
3. PR #107: realizar un solo intento automático de carga de inventario por foco, permitir un nuevo intento al reconectar o cambiar de plan y ofrecer recuperación cuando los datos restaurados estén incompletos.
4. PR #108: interpretar fechas de Odoo sin zona como UTC y mostrar tickets actuales con UTC-6 de Ciudad de México incluso en Android con una base horaria antigua.

Quedan fuera los incrementos de versión de staging, `app.config.ts`, iconos, selección dinámica de base de datos y cualquier otro cambio que no forme parte de los cuatro commits funcionales.

## Estrategia

La rama nace de `origin/main` en el commit que contiene el PR #111. Los cuatro commits funcionales se incorporan en su orden de dependencia: #104, #106, #107 y #108. Antes de cada incorporación se ejecuta su prueba de regresión contra `main` para comprobar que detecta el comportamiento faltante; después se aplica el commit y se repite la prueba.

Los conflictos se resuelven conservando la configuración de producción de `main`. El cambio de `tests/appConfigVariants.test.mjs` incluido originalmente en #107 se excluye porque solo incrementa la versión Android de staging y no verifica la corrección funcional.

## Verificación

La validación automatizada comprende las cuatro pruebas de regresión, TypeScript, revisión de espacios con `git diff --check` y la suite completa dividida en grupos cuando Windows exceda su límite de longitud de comando. También se generará un APK con el perfil `production-apk` si la sesión de Expo ya está autenticada y el servicio permite iniciar la compilación.

La validación en dispositivo cubre: iniciar ruta y reiniciar la app; preparar con señal y abrir un cliente sin señal; reabrir la ruta sin provocar un ciclo de solicitudes; y consultar tickets de venta y cambio con hora de Ciudad de México. La compilación demuestra que el binario se genera; la validación del recorrido requiere instalarlo en Android.

## Riesgos y límites

La recuperación de ruta comparte archivos con infraestructura de staging. Solo se conservarán imports que ya existan en `main` o sean necesarios para la corrección. El APK no corrige por sí solo estados o inventario inconsistentes en Odoo. Tampoco incluye el PR #109 de prospectos, que sigue dependiendo del backend #213.
