# QA de impresión Bluetooth MP210

## Estado

**Implementación y transporte nativo aprobados; validación visual del papel
pendiente de confirmación humana.** La aplicación instalada seleccionó la MP210
emparejada y envió correctamente el diagnóstico y un ticket real sin usar
Thermer ni convertir el PDF. Android confirmó ambos envíos. Este documento no
declara todavía que el papel salió completo, legible y sin recorte.

## Identificación de la ejecución

- Rama: `codex/mp210-bluetooth-printing`.
- Base de `main`: `5d121dad0539b01084f4816110db547f0cbe4bd0`.
- Fecha: 2026-07-22 (`America/Mexico_City`).
- Dispositivo: Samsung SM-A042M, Android 14, serie `R8YW8091JCY`.
- Impresora: MP210 emparejada en `DC:0D:51:D9:A8:5F`.
- Transporte: Bluetooth Classic SPP directo, 58 mm y 384 puntos.

## Prebuild limpio, autolinking y permisos

Se regeneró Android desde la configuración rastreada, sin reutilizar el árbol
nativo anterior:

```text
$ npx expo prebuild --platform android --clean --no-install
✔ Cleared android code
✔ Created native directory
✔ Finished prebuild
```

Después del Prebuild limpio:

```text
$ node scripts/verify-thermal-printer-android.mjs
Thermal printer Android permissions verified in android/app/src/main/AndroidManifest.xml
```

El autolinking generado incluye:

```text
packageName: thermal-printer
sourceDir: modules/thermal-printer/android
module: mx.grupofrio.thermalprinter.ThermalPrinterModule
```

Permisos resultantes:

| Permiso | Configuración | Resultado |
| --- | --- | --- |
| `android.permission.BLUETOOTH` | `maxSdkVersion="30"` | Aprobado |
| `android.permission.BLUETOOTH_ADMIN` | `maxSdkVersion="30"` | Aprobado |
| `android.permission.BLUETOOTH_CONNECT` | sin `maxSdkVersion` | Aprobado |
| `android.permission.BLUETOOTH_SCAN` | ausente | Aprobado |

## Verificación automatizada

| Comando | Resultado fresco |
| --- | --- |
| `npm test` | 413 aprobadas, 0 fallidas, 0 omitidas |
| `npm run typecheck` | exit 0; `tsc --noEmit` sin errores |
| `:thermal-printer:testDebugUnitTest` | 157 aprobadas, 0 fallidas |
| `:app:assembleRelease` | `BUILD SUCCESSFUL`; 1276 tareas |
| `:thermal-printer:connectedDebugAndroidTest` | 2 aprobadas en el Samsung, 0 fallidas |

La regresión de selección prueba que los nombres que **contienen** `MP210`
tienen prioridad tanto en TypeScript como en Kotlin.

## APK instalado

| Variante | Tamaño | SHA-256 |
| --- | ---: | --- |
| Release | 68,793,613 bytes | `448726558e7298b814667180aac19e0d15a1fcf7d2036f5706d213a80c39db5b` |

La instalación con `adb install -r` terminó con `Success`. El APK recuperado
del dispositivo conserva exactamente el mismo SHA-256. `apkanalyzer` confirmó
que contiene `mx.grupofrio.thermalprinter.ThermalPrinterModule`.

## Prueba del flujo nativo

En la aplicación instalada se comprobó:

1. La pantalla del ticket presenta `Imprimir en MP210` como acción primaria y
   `Abrir PDF` únicamente como alternativa.
2. Android solicitó el permiso de dispositivos cercanos.
3. El selector mostró las impresoras emparejadas y permitió elegir MP210.
4. `Imprimir diagnóstico` terminó con `Diagnóstico enviado a MP210`.
5. Un ticket real de la venta `S24000` terminó con `Ticket enviado a MP210`.

Esto aprueba el descubrimiento, selección persistida, conexión SPP, renderizado,
envío de bytes y respuesta de éxito de la aplicación. No se abrió una aplicación
externa y no se usó el PDF como imagen.

## Validación visual pendiente

Una persona debe confirmar sobre el papel:

- diagnóstico y ticket completos y legibles;
- ancho útil correcto, sin ensanchamiento ni recorte lateral;
- líneas extremas, logo, acentos, moneda, productos e importes correctos;
- avance suficiente para corte manual;
- diagnóstico largo completo, sin truncamiento.

Hasta recibir esa confirmación, la aceptación física permanece pendiente aunque
la ruta nativa y el transporte Bluetooth ya están comprobados.

## Evidencia adicional: folio Odoo (2026-07-25)

Esta ejecución corresponde a la rama `codex/odoo-ticket-folio` y verifica los
cambios de folio Odoo, referencia local pendiente y consumo frontend del
vendedor recibido de Odoo. La resolución autoritativa del vendedor en backend
sigue pendiente y no fue probada en esta ejecución. Esta evidencia no reemplaza
la ejecución histórica del 2026-07-22 documentada arriba.

### Verificación automatizada

| Comando o alcance | Resultado fresco |
| --- | --- |
| `npm test -- --runInBand` | 456 de 456 pruebas aprobadas; exit 0 |
| `npm run typecheck` | exit 0 |
| `git diff --check` | limpio |
| Pruebas Kotlin enfocadas de Task 7 | `BUILD SUCCESSFUL`; `ThermalPrinterModuleTest`: 9 de 9 y `ThermalTicketLayoutTest`: 34 de 34; 43 en total, 0 fallidas |
| Suite Kotlin completa | 164 pruebas, 0 fallidas; 43 pertenecen a las dos clases de Task 7 |
| `./gradlew :thermal-printer:testDebugUnitTest :app:assembleRelease --offline --no-daemon --console=plain` | `BUILD SUCCESSFUL` en 2 min 8 s; 1276 tareas accionables (881 ejecutadas y 395 actualizadas) |

El APK producido localmente fue:

| Ruta | Tamaño | SHA-256 |
| --- | ---: | --- |
| `android/app/build/outputs/apk/release/app-release.apk` | 69,031,393 bytes | `e250385b2eae47aa75605e5a21a89684deae8a1485f5b592e8cd9a49802c7f94` |

### Límites de esta ejecución

El Android limpio **no quedó verificado**. El comando
`npx expo prebuild --platform android --clean --no-install` requería descargar
`expo-template-bare-minimum` para SDK 52 y la descarga/red necesaria no estuvo
autorizada ni disponible. Para compilar y ejecutar las pruebas se copió un
scaffold Android existente; este uso fue exclusivamente local.

Además, `node scripts/verify-thermal-printer-android.mjs` falla porque encuentra
0 ocurrencias de `android.permission.BLUETOOTH` en el manifest generado. Por
esta razón, aunque la compilación terminó correctamente, el APK anterior **no
es candidato de entrega ni de instalación**.

`adb devices -l` no mostró dispositivos conectados. No se instaló este APK y
no se realizó una impresión física. Esta ejecución no afirma resultados sobre
papel, apertura de PDF ni comportamiento físico de una MP210.
