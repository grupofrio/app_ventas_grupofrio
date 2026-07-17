# KoldField — Build APK QA (instrucciones + evidencia)

**Veredicto:** `APK_BUILT_AND_VERIFIED`. El APK release de continuidad se compiló localmente y pasó las validaciones automáticas de metadata, versión y firma. La aceptación manual del flujo de inicio de ruta sobre **este APK exacto** queda pendiente porque no se instaló en el emulador sin autorización explícita.

## Build verificado — 2026-07-14

| Campo | Valor |
|---|---|
| Commit funcional compilado | `d8cdf3d90fcec1ac8506d9305a2caab7f164c007` (`codex/fix-authoritative-route-start`) |
| Perfil | Gradle `release` local de continuidad (`clean assembleRelease`) |
| Ambiente/URL | `grupofrio.odoo.com` (producción, salvo override de env) |
| APK | `android/app/build/outputs/apk/release/app-release.apk` |
| Tamaño | 68,811,588 bytes (~66 MiB) |
| SHA-256 APK | `04003ca509ded35c6e1584a197434209eb5c1a01e9a9ca995c73895f7cd46b53` |
| Package | `mx.grupofrio.koldfield` |
| Version / versionCode | `1.3.1` / `3` |
| SHA-256 certificado | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| typecheck | limpio (exit 0) |
| tests | 137/137, 0 fallas |
| Android build | `BUILD SUCCESSFUL in 3m 4s` (1337 tareas: 1179 ejecutadas, 158 actualizadas) |
| Verificación del APK | limpia (exit 0) |
| Bundle JS embebido | SHA-256 `1895f51f76e60a3301228005c114ee09966a1d397657f17324f69aef36ba2b35`; idéntico al bundle generado y contiene `plan_id debe ser un entero positivo` y `route_refresh_kept_cached_stops` |

## Comandos y resultados

```bash
npm run typecheck
# exit 0

npm test
# tests 137 · pass 137 · fail 0

GRADLE_OPTS='-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8 -Dorg.gradle.workers.max=1' npm run build:field-update:android
# ejecuta: cd android && ./gradlew clean assembleRelease
# BUILD SUCCESSFUL in 3m 4s

npm run verify:field-update:android
# exit 0; package, versionCode, versionName y certificado coinciden
```

El directorio nativo `android/` está ignorado por Git y no existe de forma automática en un worktree nuevo. Para esta compilación se copió al worktree el proyecto nativo de continuidad ya existente, junto con su keystore, excluyendo `.gradle/` y todos los builds previos. `android/app/build.gradle` también se actualizó localmente a `versionCode 3`. El script ejecutó `clean` antes de `assembleRelease`, por lo que Gradle generó el bundle y el APK desde el código del commit indicado, sin reutilizar un APK anterior.

Se extrajo `assets/index.android.bundle` del APK final y se comparó byte por byte con el bundle generado por Gradle. Ambos tienen SHA-256 `1895f51f76e60a3301228005c114ee09966a1d397657f17324f69aef36ba2b35`; el bundle embebido contiene las cadenas exclusivas del endurecimiento actual `plan_id debe ser un entero positivo` y `route_refresh_kept_cached_stops`. El artefacto anterior con SHA-256 `faf9a7cc97a87da384deafa213ebcf426398b6a3198d0e3165ea075bca7fb762` queda sustituido y no debe distribuirse.

En esta máquina, el primer build limpio agotó el heap nativo de 2 GiB en `:app:collectReleaseDependencies`; un intento con dos workers además expuso una carrera de archivos durante dexing. La ejecución verificada usó un override temporal de 4 GiB y un solo worker, mostrado arriba. Este ajuste no cambia el contenido ni la metadata del APK.

## Estado de aceptación manual

`adb devices -l` detectó `emulator-5554`. El emulador tenía instalada y ejecutándose la versión anterior con package `mx.grupofrio.koldfield`, versionName `1.3.1` y versionCode `2`. No se instaló ni actualizó con el APK `versionCode 3` recién generado, por lo que ese dato **no demuestra** la aceptación del artefacto de este build.

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
