# Checklist de release interno — KOLD Field

Úsalo cada vez que generas un APK para distribuir a vendedores. Marca cada casilla. Si una falla, **no envíes el APK** hasta resolverla.

## 1. Preparación de rama

- [ ] Estoy en `main` (o en una rama release etiquetada explícitamente). Comando: `git branch --show-current`
- [ ] Working tree limpio. Comando: `git status -s` (debe estar vacío)
- [ ] Tengo lo más reciente. Comando: `git pull origin main`

## 2. Versionado

- [ ] `expo.version` en `app.json` corresponde al release que voy a sacar (semver: MAYOR.MENOR.PATCH).
- [ ] `package.json` `version` está alineado con `app.json` `expo.version` (deben coincidir).
- [ ] **`android.versionCode` verificado contra el release anterior**:
  - Debe ser **estrictamente mayor** que el del release anterior distribuido.
  - Para continuidad sobre teléfonos de vendedores, la fuente de verdad actual es el APK firmado con `CN=Android Debug` documentado en `docs/android-update-continuity.md`.
  - **No inventar `versionCode`** sin verificar el release anterior — si Android instala un APK con `versionCode` igual o menor al instalado, falla.
  - Comando para ver el actual del repo: `node -e "console.log(require('./app.json').expo.android?.versionCode ?? '(no definido)')"`
- [ ] Si voy a subir a Play Store, `versionCode` es obligatorio y debe incrementarse.

## 3. Calidad de código

- [ ] Tests pasan. Comando: `npm test` (requiere Node `>=22.6`)
- [ ] Typecheck pasa. Comando: `npm run typecheck`
- [ ] No hay warnings nuevos en consola que indiquen regresiones.

## 4. Build

- [ ] Build correcto generado:
  - Para continuidad sobre APK ya instalado en vendedores: `npm run build:field-update:android`
  - Verificación de continuidad: `npm run verify:field-update:android`
  - Para vendedores por flujo EAS: `npm run build:preview:android`
  - Para Play Store: `npm run build:prod:android`
  - **Nunca** `expo run:android`, `npm run android` ni `npm run android:dev` para distribución.
- [ ] Si usé EAS, EAS reportó éxito y tengo el link de descarga del APK / AAB.
- [ ] Si usé continuidad local, confirmé package, versionCode, versionName y firma del APK generado.

## 5. Validación en device físico

- [ ] APK instalado en un Android real (no emulador).
- [ ] Si el teléfono ya tenía KOLD Field, el APK nuevo se instaló **encima** sin pedir desinstalación.
- [ ] App abre con Metro **APAGADO** en mi PC. No aparece la pantalla roja "Could not connect to development server".
- [ ] **Endpoint correcto confirmado**: el login se conecta al Odoo esperado para este release (no a otro entorno) — verificar revisando los logs de la pantalla de Sync o haciendo un check-in y validando que llegue al backend correcto.
- [ ] Login funciona.
- [ ] Navegación principal funciona: Home, Ruta, Ventas, Inventario, Alertas.
- [ ] Flujo mínimo de venta/pedido funciona end-to-end: entrar a un stop, agregar producto, capturar venta, ver que entra en cola de sync, drena cuando hay red.
- [ ] Versión visible en la app coincide con el release esperado.

## 6. Distribución

- [ ] APK renombrado según convención: `KOLD-Field-{perfil}-v{versión}-{YYYYMMDD}.apk`
- [ ] Subido al canal correcto (Drive privado / Firebase App Distribution / link interno).
- [ ] Registrado en planilla de envíos: vendedor, versión, `versionCode`, perfil, fecha, quién envió.
- [ ] Vendedor confirmó que pudo instalar y abrir la app.

## 7. Confirmación final

- [ ] Confirmé explícitamente que NO envié una development build.
- [ ] Si el vendedor reporta error de Metro, sé que es una build mal seleccionada y procedo a reemplazar.

---

## En caso de error tras instalar

1. Identificar qué APK se mandó (perfil, versión, `versionCode`, fecha) consultando la planilla.
2. Si fue dev build → desinstalar y reemplazar por preview.
3. Si fue preview pero falla algo distinto → revisar logs en pantalla Sync de la app, correlacionar con monitoring del backend.
4. Documentar el incidente y abrir BLD si la causa raíz amerita un fix.

## Pendientes técnicos del proceso (no del checklist por release)

- Definir el canal único de distribución (Drive privado / Firebase App Distribution / link interno) para evitar confusión entre versiones enviadas por chat.
- Definir y documentar el SHA-1 del keystore de release usado por EAS (se obtiene con `eas credentials` después del primer build).
- Diseñar la migración desde la firma actual `CN=Android Debug` hacia un keystore release formal sin romper operación de vendedores.
