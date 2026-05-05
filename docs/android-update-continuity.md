# Continuidad de actualización Android en campo

## Fuente de verdad actual

El APK instalado previamente en teléfonos de vendedores y verificado localmente es:

- Archivo: `android/app/build/outputs/apk/release/app-release.apk`
- Fecha: `2026-04-26 21:23:11`
- Package: `mx.grupofrio.koldfield`
- `versionName`: `1.3.1`
- `versionCode`: `1`
- Firma: `android/app/debug.keystore`
- Alias: `androiddebugkey`
- Certificado: `CN=Android Debug`
- SHA-256 del certificado: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`

## Decisión operativa

Mientras existan teléfonos con ese APK instalado, cualquier APK de actualización in-place debe:

1. Mantener `package = mx.grupofrio.koldfield`
2. Mantener la misma firma (`debug.keystore` actual)
3. Incrementar `versionCode` de forma estricta
4. Generarse como `release` con bundle JS embebido para no depender de Metro

Para el siguiente build de continuidad, la meta mínima es:

- `versionName = 1.3.1`
- `versionCode = 2`
- misma firma

## Comandos operativos

### Generar APK de continuidad

```bash
npm run build:field-update:android
```

Eso ejecuta `./gradlew assembleRelease` dentro de `android/` y produce:

```text
android/app/build/outputs/apk/release/app-release.apk
```

### Verificar metadata y firma del APK generado

```bash
npm run verify:field-update:android
```

La verificación debe confirmar:

- `package = mx.grupofrio.koldfield`
- `versionCode = 2`
- `versionName = 1.3.1`
- SHA-256 del certificado igual a `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`

## Validación mínima antes de compartir

1. Instalar el APK nuevo encima del APK anterior sin desinstalar
2. Abrir la app con Metro apagado
3. Validar login
4. Validar flujo mínimo de visita

Comandos útiles con `adb`:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell pm path mx.grupofrio.koldfield
```

Si `adb install -r` pide desinstalar o falla por firma, detener distribución.

## Manejo del keystore

`android/app/debug.keystore` no debe subirse al repo ni compartirse en canales inseguros. Aunque sea un keystore de debug, aquí funciona como artefacto sensible de continuidad de firma. Respáldalo fuera del repo en un almacén controlado.

## Límite de esta estrategia

Esto es una solución operativa de continuidad, no la estrategia final de producción.

Migrar a un keystore release formal o a credenciales administradas por EAS cambiará la firma del APK. Eso rompe la actualización in-place sobre los teléfonos que hoy tienen la firma `CN=Android Debug`, por lo que esa migración requerirá un plan explícito de reinstalación o transición.
