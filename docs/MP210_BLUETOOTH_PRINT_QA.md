# QA de impresión Bluetooth MP210

## Estado

**Incompleta y bloqueada por el entorno de ejecución.** La configuración y las
pruebas JavaScript descritas abajo sí tienen evidencia fresca. El Prebuild
limpio, las tareas Gradle, los APK, la instrumentación conectada y la aceptación
física siguen pendientes. Este documento no afirma una impresión física
satisfactoria.

## Identificación de la implementación

- Rama: `codex/mp210-bluetooth-printing`.
- SHA verificado antes de este documento:
  `17be5200b735a5cab6798b48b812d56b4236163e`.
- Serie MP210: 29 commits desde `6eca507` hasta `17be520`.
- Fecha de la ejecución: 2026-07-22 03:32 CST (`America/Mexico_City`, UTC-06:00).
- Plataforma objetivo: Android, Bluetooth Classic SPP, MP210 de 58 mm con
  ancho imprimible de 384 puntos.

## Android generado y Prebuild

`android/` es un resultado generado e ignorado por Git:

```text
$ git check-ignore -v android
.gitignore:41:/android android
```

Se intentó primero el comando requerido:

```text
$ npx expo prebuild --platform android --clean
- Clearing android
✔ Cleared android code
- Creating native directory (./android)
npm view expo-template-bare-minimum@sdk-52 dist --json exited with non-zero code: 1
✖ Failed to create the native directory
```

El entorno no permitió la consulta necesaria para obtener la plantilla SDK 52.
La solicitud de ejecución con red ampliada tampoco estuvo disponible por el
límite de uso del entorno. Por tanto, **el Prebuild limpio no está aprobado**.

Para continuar la verificación sin presentar el resultado como un Prebuild
limpio, se copió únicamente el esqueleto `android/` generado e ignorado del
workspace raíz, excluyendo `.gradle`, `build`, `app/build` y `.DS_Store`. Se
intentó después:

```text
$ npx expo prebuild --platform android --no-install
npm view expo-template-bare-minimum@sdk-52 dist --json exited with non-zero code: 1
✖ Failed to create the native directory
```

Expo CLI 52 también resuelve la plantilla antes de su fase incremental. Como
alternativa explícita y local, se ejecutó solamente la fase oficial de
sincronización de configuración mediante APIs instaladas de
`@expo/prebuild-config` y `@expo/config-plugins`:

```text
$ env EXPO_OFFLINE=1 node -e 'const { getPrebuildConfigAsync } = require("@expo/prebuild-config"); const { compileModsAsync } = require("@expo/config-plugins"); const projectRoot = process.cwd(); (async () => { const { exp } = await getPrebuildConfigAsync(projectRoot, { platforms: ["android"], packageName: "mx.grupofrio.koldfield" }); await compileModsAsync(exp, { projectRoot, platforms: ["android"], assertMissingModProviders: false }); console.log("Expo Android config mods applied from tracked configuration"); })().catch((error) => { console.error(error); process.exitCode = 1; });'
» android: userInterfaceStyle: Install expo-system-ui in your project to enable this feature.
Expo Android config mods applied from tracked configuration
```

Resultado: exit 0. Esta fase aplicó al esqueleto local la configuración y los
plugins rastreados actuales; no sustituyó ni aprobó el Prebuild limpio.

## Autolinking y manifiesto

```text
$ npx expo-modules-autolinking resolve --platform android
exit 0
packageName: thermal-printer
sourceDir: modules/thermal-printer/android
module: mx.grupofrio.thermalprinter.ThermalPrinterModule
```

El módulo local de KOLD está incluido en la resolución de módulos Expo. La
verificación automatizada del manifiesto también terminó correctamente:

```text
$ node scripts/verify-thermal-printer-android.mjs
Thermal printer Android permissions verified in android/app/src/main/AndroidManifest.xml
```

Evidencia del manifiesto generado:

| Permiso | Ocurrencias | Atributos | Resultado |
| --- | ---: | --- | --- |
| `android.permission.BLUETOOTH` | 1 | `maxSdkVersion="30"` | Aprobado |
| `android.permission.BLUETOOTH_ADMIN` | 1 | `maxSdkVersion="30"` | Aprobado |
| `android.permission.BLUETOOTH_CONNECT` | 1 | sin `maxSdkVersion` | Aprobado |
| `android.permission.BLUETOOTH_SCAN` | 0 | ausente | Aprobado |

No hay permisos Bluetooth duplicados.

## Verificación JavaScript y TypeScript

| Comando | Resultado fresco |
| --- | --- |
| `npm test` | exit 0; 179 archivos; 413 pruebas aprobadas, 0 fallidas, 0 omitidas |
| `npm run typecheck` | exit 0; `tsc --noEmit` sin errores |

## Gradle, pruebas JVM y builds

El comando requerido no pudo iniciar Gradle dentro del sandbox:

```text
$ ./android/gradlew -p android :thermal-printer:testDebugUnitTest
java.io.FileNotFoundException: ~/.gradle/.../gradle-8.10.2-all.zip.lck
(Operation not permitted)
```

La elevación para que Gradle utilizara su caché local no estuvo disponible por
el límite de uso del entorno. Se probó además Gradle 8.10.2 ya instalado, con un
`GRADLE_USER_HOME` escribible y aislado en `/private/tmp` y la caché de
dependencias existente como solo lectura. El proceso llegó a Gradle, pero el
sandbox bloqueó sus sockets locales internos:

```text
java.net.SocketException: Operation not permitted
BUILD FAILED
```

Esto impide producir evidencia fresca para las siguientes tareas; todas quedan
pendientes, no fallidas por un defecto demostrado del código:

- `:thermal-printer:testDebugUnitTest`;
- `assembleDebug`;
- `assembleRelease`.

No se reutilizaron resultados o APK antiguos como si fueran evidencia fresca.

### Artefactos esperados

| Variante | Ruta esperada | Tamaño | SHA-256 | Estado |
| --- | --- | --- | --- | --- |
| Debug | `android/app/build/outputs/apk/debug/app-debug.apk` | no disponible | no disponible | Pendiente de build fresco |
| Release | `android/app/build/outputs/apk/release/app-release.apk` | no disponible | no disponible | Pendiente de build fresco |

## Dispositivo e instrumentación

```text
$ adb devices
List of devices attached

```

No hubo dispositivo ni emulador autorizado. Por ello no se ejecutó
`:thermal-printer:connectedDebugAndroidTest`; queda pendiente para Task 14 en el
dispositivo físico.

## Aceptación física MP210

Toda esta sección permanece **pendiente**:

- diagnóstico completo y legible;
- líneas visibles en x=0 y x=383;
- logo reconocible;
- acentos y símbolo de moneda correctos;
- ticket de contado con varias líneas;
- ticket de crédito con pagaré;
- diagnóstico y ticket de venta largo con payload raster mayor a 64 KB;
- nombres largos de producto y cliente;
- total e importes sin recorte;
- avance suficiente para corte manual;
- confirmación explícita antes de reimprimir tras una interrupción parcial.

La funcionalidad no se considerará terminada hasta completar los builds, la
instrumentación conectada y una impresión real satisfactoria en la MP210.

## Pendientes para reanudar Task 13

1. Repetir `npx expo prebuild --platform android --clean` con acceso a la
   plantilla SDK 52 y exigir un resultado exitoso.
2. Repetir el verificador de autolinking y manifiesto sobre ese Android limpio.
3. Ejecutar las pruebas Gradle y ambos builds en un entorno que permita los
   locks y sockets locales de Gradle.
4. Registrar tamaño y SHA-256 de cada APK fresco.
5. Ejecutar instrumentación conectada y la aceptación física de Task 14.
