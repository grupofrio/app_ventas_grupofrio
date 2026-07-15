# KoldField — Build APK QA (instrucciones + evidencia)

**Veredicto:** `APK_BUILT_AND_VERIFIED`. El APK release de continuidad se compiló localmente y pasó las validaciones automáticas de metadata, versión y firma. La aceptación manual del flujo de inicio de ruta sobre **este APK exacto** queda pendiente porque no se instaló en el emulador sin autorización explícita.

## Build verificado — 2026-07-14

| Campo | Valor |
|---|---|
| Commit funcional compilado | `9b21e9ec7f00126522779237e89bf5dc70be7005` (`codex/fix-authoritative-route-start`) |
| Perfil | Gradle `release` local de continuidad (`assembleRelease`) |
| Ambiente/URL | `grupofrio.odoo.com` (producción, salvo override de env) |
| APK | `android/app/build/outputs/apk/release/app-release.apk` |
| Tamaño | 68,810,652 bytes (~66 MiB) |
| SHA-256 APK | `9bbcdfb798c6457bddc258e8b646fa550a9d1f43da28809ab1c3473fcdda1bc7` |
| Package | `mx.grupofrio.koldfield` |
| Version / versionCode | `1.3.1` / `2` |
| SHA-256 certificado | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| typecheck | limpio (exit 0) |
| tests | 135/135, 0 fallas |
| Android build | `BUILD SUCCESSFUL in 2m 16s` (1303 tareas) |
| Verificación del APK | limpia (exit 0) |

## Comandos y resultados

```bash
npm run typecheck
# exit 0

npm test
# tests 135 · pass 135 · fail 0

npm run build:field-update:android
# BUILD SUCCESSFUL in 2m 16s

npm run verify:field-update:android
# exit 0; package, versionCode, versionName y certificado coinciden
```

El directorio nativo `android/` está ignorado por Git y no existe de forma automática en un worktree nuevo. Para esta compilación se copió al worktree el proyecto nativo de continuidad ya existente, junto con su keystore, excluyendo `.gradle/` y todos los builds previos. Así, Gradle generó el bundle y el APK desde el código del commit indicado, sin reutilizar un APK anterior.

## Estado de aceptación manual

`adb devices -l` detectó `emulator-5554`. El emulador ya tenía instalada y ejecutándose una app con package `mx.grupofrio.koldfield`, versionName `1.3.1` y versionCode `2`. No se instaló ni actualizó con el APK recién generado, por lo que ese dato **no demuestra** la aceptación del artefacto de este build.

Prueba pendiente en dispositivo/cuenta controlados:

1. [ ] Instalar este APK con `adb install -r` encima de la versión anterior y confirmar continuidad de firma.
2. [ ] Limpiar datos/cache e iniciar sesión con una cuenta de prueba.
3. [ ] Cargar un plan Odoo `in_progress` con `departure_km > 0`.
4. [ ] Confirmar que “Iniciar operación” muestra el KM del backend.
5. [ ] Abrir Venta directamente y confirmar que no aparece “Ruta no iniciada”.
6. [ ] Reiniciar offline y confirmar que Venta sigue disponible con el mismo plan cacheado.
7. [ ] Cargar otro plan `published` y confirmar que el KM/checklist anterior no lo autoriza.

## Configuración de continuidad Android

Mientras existan teléfonos con el APK de campo actual, cualquier actualización in-place debe:

1. Mantener `package = mx.grupofrio.koldfield`.
2. Mantener la misma firma de continuidad.
3. Incrementar `versionCode` de forma estricta.
4. Generarse como `release` con el bundle JS embebido para no depender de Metro.

El comando operativo es:

```bash
npm run build:field-update:android
npm run verify:field-update:android
```

Antes de distribuir, instalar encima del APK anterior sin desinstalar, abrir con Metro apagado y validar el flujo mínimo de ruta/venta. Si `adb install -r` falla por firma o exige desinstalar, detener la distribución.

## Riesgos y límites

- El APK apunta por defecto a Odoo producción. La aceptación manual debe usar una ruta/cuenta de prueba controlada y no crear ventas reales accidentales.
- El `android/app/debug.keystore` funciona como artefacto sensible de continuidad; no debe subirse al repositorio ni compartirse por canales inseguros.
- Migrar a un keystore release formal o a credenciales EAS cambiaría la firma y requeriría un plan explícito de reinstalación o transición para los teléfonos existentes.
