# KOLD Field

App móvil de ventas para vendedores de Grupo Frío. Stack: Expo SDK 52 + React Native 0.76 + expo-router + zustand. Backend: Odoo (`grupofrio.odoo.com`) vía REST y JSON-RPC.

## Requisitos

- Node `>=22.6` (necesario para `npm test`, que usa `--experimental-strip-types` para los archivos `.test.ts`).
- `eas-cli` instalado y autenticado para generar builds en EAS Cloud (`npm install -g eas-cli`).
- Android SDK + USB debug solo si vas a hacer development build localmente.

El campo `engines.node` en `package.json` deja documentada esta restricción.

## Tipos de build

| Tipo | Comando | Para quién | Depende de Metro | Bundle JS embebido |
|------|---------|------------|------------------|--------------------|
| **development** | `npm run android:dev` o `npm run build:dev:android` | Solo desarrolladores | SÍ | NO |
| **preview** | `npm run build:preview:android` | Vendedores, pilotos, pruebas internas | NO | SÍ |
| **production** | `npm run build:prod:android` | Distribución formal (Play Store) | NO | SÍ |

## Continuidad de update en campo

Existe un caso temporal distinto al flujo normal de EAS: los teléfonos de vendedores que ya tienen instalado el APK firmado con `CN=Android Debug`.

Para actualizar **encima** de esa instalación sin reinstalar, usa:

```bash
npm run build:field-update:android
npm run verify:field-update:android
```

Ese flujo genera un `release` local de Gradle con bundle JS embebido y la misma firma actual del repo. La documentación completa está en [docs/android-update-continuity.md](docs/android-update-continuity.md).

> Esto es una solución operativa de continuidad, no la estrategia final de producción. Migrar a keystore release formal o EAS-managed credentials requerirá plan de transición porque cambiar la firma rompe update in-place.

### APK que SÍ se puede compartir con vendedores

- **preview** — APK release firmado con bundle JS embebido. **Confirmar el endpoint correcto antes de distribuir** revisando que el login se conecte al Odoo de producción esperado (la base URL es configurable en runtime, no asumas).

### APK que NO se puede compartir con vendedores

- **development** — depende de Metro corriendo en `localhost:8081`. En el celular del vendedor mostrará la pantalla roja "Could not connect to development server".
- Cualquier APK generado con `expo run:android`, `npm run android` o `npm run android:dev`. Esos son development builds.

> Los scripts `npm run android` y `npm run android:dev` existen únicamente para tu máquina de desarrollo. **Nunca** los uses para generar el APK que recibe un vendedor.

## Instalación reproducible

```bash
npm ci
```

Se usa `npm ci` (no `npm install`) porque existe `package-lock.json` y queremos una instalación determinista que respete las versiones del lock file.

## Cómo generar el APK correcto para un vendedor

Requisito previo: cuenta Expo con `eas-cli` instalado y autenticado. El primer `eas build` te pedirá vincular el proyecto a una cuenta — coordinar con dirección antes.

```bash
git checkout main
git pull
git status                      # debe estar limpio
npm ci                          # instalación reproducible
npm run typecheck               # debe pasar
npm test                        # debe pasar
npm run build:preview:android   # genera APK preview en EAS Cloud
```

EAS te devuelve un link de descarga (`.apk`) cuando termina (~10–15 minutos en cloud).

Si el objetivo es **actualizar encima del APK ya instalado en vendedores**, no uses este flujo hasta confirmar que EAS firma con el mismo certificado. En ese caso usa el flujo temporal de continuidad local documentado arriba.

## Cómo instalar el APK en un Android físico

1. Descarga el `.apk` al teléfono (link directo, Drive privado, etc.).
2. En el teléfono: Configuración → Seguridad → Instalar apps de fuentes desconocidas → habilita para el navegador o gestor de archivos.
3. Toca el `.apk` y acepta la instalación.
4. Abre la app.

## Cómo verificar que el APK NO depende de Metro

1. Cierra Metro en tu PC (Ctrl+C en la terminal donde corre `npm start`).
2. Pon el teléfono en modo avión un momento, después restaura conexión a internet móvil (no wifi compartido con tu PC).
3. Abre la app.
4. Debe abrir normalmente. **Si muestra la pantalla roja con `localhost:8081`, el APK es development y NO se debe distribuir.**

## Versionado

- `expo.version` en `app.json` y `version` en `package.json` deben coincidir antes de cualquier release.
- `android.versionCode` está fijado en `app.json` y debe incrementarse en cada APK distribuible Android.
- Para continuidad de update sobre vendedores, además de incrementar `versionCode`, la firma debe mantenerse idéntica al APK ya instalado.

## Checklist mínimo antes de mandar un APK a un vendedor

Lista corta. La completa está en [docs/release-checklist.md](docs/release-checklist.md).

- [ ] El APK es del perfil `preview` o `production`, nunca `development`
- [ ] La app abre con Metro apagado
- [ ] Login funciona contra el endpoint correcto (verificar antes de distribuir)
- [ ] `versionCode` del APK es estrictamente mayor que el release anterior
- [ ] La firma del APK coincide con la del APK ya instalado si se va a actualizar in-place
- [ ] Versión visible en la app coincide con la que se compartió
- [ ] Nombre del archivo sigue la convención (ver abajo)
- [ ] Registrado a quién se mandó

## Convención de nombres de archivo APK

```
KOLD-Field-{perfil}-v{versión}-{YYYYMMDD}.apk
```

Ejemplo:

```
KOLD-Field-preview-v1.3.1-20260429.apk
```

- `{perfil}` = `preview` o `production` (jamás `development` para distribución)
- `{versión}` = `expo.version` de `app.json`
- `{YYYYMMDD}` = fecha del build (UTC para evitar ambigüedad de zona horaria)

## Registro de envíos

Cada APK que se mande a un vendedor debe quedar registrado. Mantén una hoja con:

| Fecha | Vendedor | Versión | versionCode | Perfil | Quién envió | Confirmación instalación |
|-------|----------|---------|-------------|--------|-------------|--------------------------|
| 2026-04-29 | Juan Pérez | 1.3.1 | 2 | continuity-local | Yamil | OK 2026-04-29 18:30 |

La hoja vive en (canal definido por dirección — Drive privado, Notion, Sheets).

## Troubleshooting

### Error: "Could not connect to development server" / `http://localhost:8081/...`

**Causa**: el APK instalado es una development build. No incluye el bundle JavaScript — espera que Metro esté corriendo en una PC accesible vía USB o red local. En un teléfono de vendedor en ruta, Metro nunca está disponible y la app no puede arrancar.

**Solución**: desinstala el APK del teléfono y reemplázalo por uno de perfil `preview` (`npm run build:preview:android`) o por el APK de continuidad local (`npm run build:field-update:android`) según el canal que toque. Nunca distribuyas APKs generados con `expo run:android`, `npm run android` o perfil `development`.

### Login dice "No se pudo conectar"

Si el dispositivo está online: verifica que tenga DNS funcional para el endpoint configurado, que no esté bajo VPN bloqueante, y que el endpoint de Odoo esté activo. Mira los logs en la pantalla de Sync.

## Desarrollo local

```bash
npm ci                # instalación reproducible
npm start             # Metro
npm run android:dev   # build dev en device/emulator (requiere Android SDK + USB debug)
npm test              # suite completa de tests (requiere Node >=22.6)
npm run typecheck     # tsc --noEmit
```

Para correr un test individual:

```bash
node --experimental-strip-types --test tests/giftPayload.test.ts
```

## Estructura

```
app/                  Rutas (expo-router file-based)
  (auth)/             Login
  (tabs)/             Home, ruta, ventas, inventario, alertas
  stop/               Visita a un cliente
  sale/               Venta en visita
  exchange/           Cambio físico
  gift/               Regalo / muestra
src/
  components/         Componentes UI y de dominio
  hooks/              React hooks
  persistence/        Storage (AsyncStorage wrapper)
  services/           Cliente API, GPS, cámara, conectividad, sync
  stores/             zustand stores
  theme/              Design tokens
  types/              TypeScript types
  utils/              Helpers
tests/                node:test, .ts y .mjs
scripts/              Helpers de tooling (test runner cross-platform)
docs/                 Specs y checklists internos
```

## Documentos relacionados

- [docs/release-checklist.md](docs/release-checklist.md) — checklist completo de release interno
- [docs/security-findings.md](docs/security-findings.md) — hallazgos de seguridad pendientes
- [docs/consignacion-spec.md](docs/consignacion-spec.md) — spec del módulo de consignación (no implementado)
