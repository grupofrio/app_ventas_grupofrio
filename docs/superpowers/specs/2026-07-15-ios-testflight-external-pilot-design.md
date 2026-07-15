# KOLD Field — Diseño de piloto externo en iPhone mediante TestFlight

**Fecha:** 2026-07-15  
**Estado:** Aprobado por el usuario  
**Objetivo:** preparar KOLD Field para que un usuario externo pueda instalarla y probarla en un iPhone mediante TestFlight, conectada a Odoo producción con una cuenta real de datos controlados.

## 1. Contexto

KOLD Field es una aplicación Expo/React Native para operación de ventas en campo. El proyecto ya declara:

- nombre `KOLD Field`;
- Bundle ID iOS `mx.grupofrio.koldfield`;
- Team ID `NSPZ9L84H2`;
- iPhone como único dispositivo iOS soportado;
- permisos de cámara y ubicación;
- ubicación en segundo plano mediante `expo-location` y `expo-task-manager`;
- perfiles EAS orientados principalmente a Android.

El App ID y el registro de la app ya fueron creados por el usuario en Apple Developer y App Store Connect. El tester será externo y no tendrá acceso administrativo. El build se conectará a Odoo producción, pero las pruebas usarán exclusivamente una cuenta real con datos controlados.

El proyecto está en Expo SDK 52. Desde el 28 de abril de 2026, Apple exige Xcode 26 y el SDK de iOS 26 para nuevas cargas. Expo garantiza ese toolchain de EAS para SDK 54 o posterior, por lo que el piloto requiere actualizar como mínimo a SDK 54.

La revisión del código confirmó además un bloqueo de seguridad previo al piloto: el bundle móvil contiene credenciales literales de una cuenta de servicio de Odoo. Distribuir ese bundle a un tester externo expondría acceso a producción. La eliminación ya está descrita en `docs/odoo-credential-removal-plan.md`, pero no está implementada. Por lo tanto, el trabajo se divide en dos proyectos secuenciales:

1. **Prerrequisito de seguridad:** eliminar la cuenta de servicio del cliente móvil y validar los endpoints seguros existentes.
2. **Piloto iOS:** actualizar Expo, configurar EAS/TestFlight y distribuir el binario ya saneado.

El plan del piloto iOS puede prepararse para dejar claras sus dependencias, pero su implementación y cualquier build externo no pueden comenzar hasta completar el prerrequisito de seguridad. El primer plan ejecutable será el de eliminación de credenciales. Si algún flujo aún carece de un endpoint seguro, el piloto queda bloqueado y el cambio necesario deberá coordinarse con el responsable de Odoo en un proyecto separado.

## 2. Decisiones

### 2.1 Canal de distribución

Se usará **TestFlight con testers externos**.

No se usará distribución Ad Hoc porque obligaría a registrar UDID y regenerar perfiles. No se usará Expo Go porque no representa fielmente la configuración nativa y no soporta la validación necesaria de ubicación en segundo plano.

### 2.2 Versión de Expo y arquitectura

Se actualizará de Expo SDK 52 a SDK 54, alineando React Native, React, Expo Router y todos los módulos Expo a versiones compatibles. La migración se hará de forma incremental por SDK y se verificará después de cada salto.

SDK 54 es la menor versión recomendada por Expo para el requisito vigente de Xcode 26. Se preservará inicialmente la arquitectura clásica de React Native mediante configuración explícita. Migrar a SDK 55/56 o adoptar obligatoriamente la nueva arquitectura queda fuera de este piloto.

### 2.3 Identidad y firma

- Bundle ID: `mx.grupofrio.koldfield`.
- App Store version inicial del piloto: conservar `1.3.1` salvo conflicto en App Store Connect.
- Build number inicial: `1`; se conservará `appVersionSource: local` y `ios.buildNumber` será el único valor autoritativo. Cada nueva carga lo incrementará manualmente antes del build para no alterar la continuidad Android mediante versionado remoto global.
- El Team ID del proyecto se comprobará contra la cuenta usada para crear el App ID. Si no coincide, se actualizará antes de crear credenciales.
- EAS administrará el certificado de distribución y el provisioning profile. No se crearán perfiles manuales ni se guardarán certificados en Git.
- El proyecto se vinculará a la cuenta/proyecto EAS correspondiente. El identificador generado se conservará en la configuración de Expo.
- Antes del build se registrarán el owner de EAS y el Apple ID numérico que App Store Connect asignó al registro. El Apple ID se usará en la configuración privada/de envío necesaria para seleccionar inequívocamente la app.

### 2.4 Capabilities y permisos

No se habilitarán capacidades adicionales en el App ID. La aplicación no usa Push Notifications, Sign in with Apple, Associated Domains, iCloud, App Groups, Apple Pay, HealthKit, NFC ni servicios equivalentes.

La cámara y la ubicación se gestionan como permisos del sistema, no como capabilities del App ID.

Para ubicación en segundo plano:

- se declarará `isIosBackgroundLocationEnabled: true` en el plugin de `expo-location`;
- se conservará únicamente `location` en `UIBackgroundModes`;
- se eliminará `fetch`, porque el proyecto no usa Background Fetch;
- se mantendrán descripciones claras para ubicación en uso, ubicación continua y cámara;
- la aplicación solicitará permiso `When In Use` y después `Always` dentro del flujo que inicia el tracking de ruta, no al arrancar sin contexto;
- se conservará el indicador azul de ubicación en segundo plano ya solicitado por el servicio.

El ciclo de vida del tracking será explícito:

1. Pulsar **Iniciar ruta** crea una sesión local de tracking ligada al `planId` y arranca el watch de primer plano.
2. Si el usuario concede `Always`, también arranca el task de segundo plano. Si conserva solo `When In Use`, la ruta puede iniciar con tracking de primer plano y una advertencia persistente; no se bloqueará toda la operación por denegar `Always`.
3. La sesión activa se persiste. Tras relanzar la app online, el tracking se reanuda únicamente si hay autenticación válida, la sesión persistida corresponde al plan vigente y el plan no está cerrado. En un relanzamiento offline se usa el plan persistido: solo se reanuda si existe, su `planId` coincide y su último estado conocido no es cerrado; al reconectar, una actualización del servidor que indique cierre detiene y limpia la sesión. Si falta el plan persistido o hay discrepancia, no se reanuda. No se solicitarán permisos automáticamente durante el arranque.
4. Un cierre exitoso de ruta detiene ambos watches y borra la sesión persistida. Un cierre fallido no los detiene.
5. Logout detiene ambos watches y borra la sesión aun si la llamada remota de logout falla.
6. Si el usuario mata la app, se aceptan las limitaciones del sistema; al volver a abrirla se aplica la regla de reanudación anterior.

### 2.5 Configuración EAS

La configuración incorporará un flujo iOS reproducible:

- script para build iOS destinado a App Store/TestFlight;
- script para enviar el último build iOS mediante EAS Submit;
- perfil de producción con distribución `store` y variables de entorno explícitas;
- versión/build number definidos de forma inequívoca;
- toolchain Xcode 26 compatible con Expo SDK 54.

No se alterarán los perfiles ni la continuidad de firma Android salvo los ajustes estrictamente necesarios para que la configuración compartida siga siendo válida.

## 3. Arquitectura y flujo de datos

El piloto no cambia contratos de negocio ni rutas de backend:

1. El tester instala KOLD Field desde TestFlight.
2. La app inicia sesión contra Odoo producción en `https://grupofrio.odoo.com` con la cuenta controlada. Antes del build se verificará que ningún override de runtime o variable EAS cambie ese destino.
3. El usuario concede permisos en contexto: ubicación al preparar/iniciar ruta y cámara al capturar evidencia.
4. El tracking en segundo plano entrega ubicaciones a `expo-task-manager`.
5. Cada ubicación se agrega a la cola de sincronización existente.
6. La cola envía operaciones a Odoo cuando existe conectividad y conserva pendientes cuando no existe.
7. TestFlight recopila métricas de instalación y fallos; los diagnósticos funcionales continúan disponibles mediante los mecanismos existentes de la app.

No se agregarán servicios de analítica, notificaciones, autenticación ni almacenamiento nuevos.

## 4. Seguridad y datos de producción

- Antes de cualquier build externo se ejecutará el proyecto independiente descrito en `docs/odoo-credential-removal-plan.md`: inventariar usos de la sesión Odoo, migrarlos a endpoints autenticados por empleado, eliminar credenciales literales y `setServiceCredentials`, agregar un guard de regresión y validar los flujos afectados en un dispositivo.
- La rotación o restricción de la credencial histórica ocurrirá fuera del código y de forma coordinada después de confirmar que ningún flujo móvil depende de ella.
- Las credenciales de demostración se introducirán únicamente en App Store Connect, en la información privada para Beta App Review. No se escribirán en código, documentación versionada, variables públicas ni notas visibles para testers.
- La cuenta controlada deberá tener el menor alcance operativo que permita revisar el flujo y no deberá afectar ventas, inventario, caja o liquidaciones reales fuera del conjunto de prueba.
- Toda operación mutante durante QA deberá estar predefinida y ser reversible o identificable en Odoo.
- La clave iOS de Google Maps deberá estar restringida en Google Cloud al Bundle ID `mx.grupofrio.koldfield`. Si la restricción no existe, se reportará como bloqueo de distribución; no se modificará Google Cloud sin autorización explícita.
- Se completarán con veracidad las preguntas de privacidad, seguimiento, cifrado y uso de ubicación de App Store Connect.

## 5. Manejo de errores y bloqueos

No se enviará el build a revisión externa si ocurre cualquiera de estos casos:

- incompatibilidad no resuelta al actualizar Expo;
- fallo de typecheck, tests o Expo Doctor que afecte el binario;
- prebuild o build iOS fallido;
- Team ID, Bundle ID, certificado o provisioning profile incorrectos;
- imposibilidad de iniciar sesión con la cuenta controlada;
- cámara, mapas, ubicación en primer plano o tracking en segundo plano inoperantes;
- configuración del build apuntando a un backend diferente del autorizado;
- credenciales o secretos incluidos en archivos versionados.

La presencia de la cuenta de servicio Odoo actual es un bloqueo conocido, no una excepción permitida. El escaneo de seguridad debe demostrar que el bundle generado no contiene el usuario ni la contraseña históricos antes de subirlo.

Los permisos denegados deberán producir un estado comprensible y recuperable. La app deberá permitir continuar con funciones que no dependan del permiso y explicar cómo habilitarlo desde Settings cuando sea imprescindible.

## 6. Estrategia de verificación

### 6.1 Automatizada

- instalación reproducible desde el lockfile;
- alineación de dependencias mediante Expo;
- `expo-doctor` sin problemas bloqueantes;
- TypeScript sin errores;
- suite completa de tests;
- inspección de la configuración Expo resultante;
- generación nativa iOS/prebuild sin errores;
- comprobación de que el binario usa Bundle ID, versión, build number y permisos correctos;
- escaneo del bundle para comprobar que no contiene la cuenta de servicio ni otras credenciales privadas;
- tests del ciclo de vida de tracking: inicio, permiso parcial, reanudación válida, cierre exitoso, cierre fallido y logout;
- validación mínima de la configuración Android compartida para detectar una regresión evidente por la actualización del SDK.

### 6.2 En iPhone físico

- instalación limpia desde TestFlight;
- arranque sin Metro ni computadora;
- login y cierre de sesión;
- permisos de ubicación `When In Use` y `Always`;
- preparación e inicio de ruta;
- mapa y geolocalización de visitas;
- tracking con la app en segundo plano y posterior sincronización;
- operación con permiso `When In Use` pero sin `Always`, mostrando degradación y recuperación claras;
- detención del tracking al cerrar ruta y al cerrar sesión;
- reanudación tras relanzar la app durante una sesión de ruta activa;
- cámara y persistencia/envío de evidencia;
- pérdida y recuperación de red;
- cierre y reapertura de la app;
- cola pendiente y sincronización;
- una operación controlada acordada en Odoo producción;
- exportación o consulta de diagnósticos ante un fallo.

## 7. Beta App Review y tester externo

Antes de solicitar revisión se completará:

- descripción de la beta;
- funciones específicas a probar;
- correo de feedback;
- nombre, teléfono y correo de contacto;
- credenciales privadas de la cuenta controlada;
- pasos exactos para llegar a mapa, cámara y tracking;
- nota justificando que la ubicación continua se usa durante una ruta activa del vendedor;
- información de cumplimiento de exportación/cifrado;
- respuestas de privacidad y clasificación por edad que App Store Connect solicite.

Se creará inicialmente un grupo externo limitado a un tester. El primer build se enviará a Beta App Review. Tras la aprobación, el tester recibirá una invitación por correo; no se usará un enlace público para este piloto.

## 8. Alcance

### Incluido

- verificación de que el prerrequisito separado de eliminación de credenciales ya fue completado;
- actualización mínima a Expo SDK 54;
- compatibilidad con Xcode 26;
- configuración iOS y EAS;
- build y envío a App Store Connect;
- preparación del primer grupo externo de TestFlight;
- documentación de release y checklist de QA iOS.

### Excluido

- publicación pública en App Store;
- rediseño visual o cambios de reglas de negocio;
- migración a Expo SDK 55/56;
- adopción de la nueva arquitectura;
- Push Notifications, Sign in with Apple u otras capabilities nuevas;
- cambios de backend/Odoo;
- implementación de la eliminación de credenciales Odoo dentro del mismo plan del piloto iOS; es un proyecto previo con su propio inventario, plan, pruebas y coordinación;
- cambios de datos reales fuera de la cuenta controlada;
- distribución empresarial, Ad Hoc o mediante enlace público;
- migración de firma o release formal Android.

## 9. Criterios de aceptación

El piloto queda listo cuando:

1. el prerrequisito de eliminación de credenciales Odoo está completo y el bundle no contiene la cuenta de servicio histórica;
2. el proyecto compila con Expo SDK 54 y Xcode 26;
3. typecheck, tests y verificaciones de Expo pasan;
4. el tracking solo se activa para una sesión de ruta, se reanuda de forma controlada y se detiene en cierre/logout;
5. un build firmado aparece procesado en App Store Connect;
6. la información de Beta App Review está completa y no expone credenciales públicamente;
7. Apple aprueba el build para pruebas externas;
8. el tester recibe la invitación, instala desde TestFlight y abre la app sin Metro;
9. login, mapas, cámara, permisos y tracking en segundo plano funcionan en un iPhone físico;
10. una operación controlada llega correctamente a Odoo o queda/sincroniza conforme al comportamiento offline existente;
11. no se introducen secretos ni se sobrescriben cambios locales ajenos al alcance.

## 10. Referencias

- Apple, requisitos de SDK: <https://developer.apple.com/news/upcoming-requirements/?id=02032026a>
- Apple, TestFlight: <https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/>
- Expo, requisito de Xcode 26: <https://expo.dev/blog/app-store-connect-minimum-sdk-26>
- Expo, capacidades iOS en EAS: <https://docs.expo.dev/build-reference/ios-capabilities/>
- Expo SDK 52, ubicación en segundo plano: <https://docs.expo.dev/versions/v52.0.0/sdk/location/>
- Plan interno de eliminación de credenciales: `docs/odoo-credential-removal-plan.md`
