# KoldField — Build APK QA (instrucciones + evidencia)

**Veredicto:** `BUILD_BLOCKED` (no por bug ni mala config, sino porque **el build no se puede ejecutar desde este entorno** —sin `eas-cli`/sesión Expo/cloud— y porque el APK apuntaría a **Odoo producción**; requiere confirmación de Yamil antes de compilar). El **frente app está cerrado y listo** (GO_APK_QA).

## Commit / tag de build
- **main funcional:** `5a3ecdb` (Merge #42). `main` actual `eb24ab0` = `5a3ecdb` + doc readiness (idéntico funcional).
- **Tag creado y pusheado:** `koldfield-qa-5a3ecdb` → `5a3ecdb`.
- **typecheck:** limpio · **tests:** 124/124.

## Configuración validada (eas.json / app.json)
- **Perfil a usar: `preview`** → `distribution: internal`, Android `buildType: **apk**` (instalable directo), env `EXPO_PUBLIC_BUILD_PROFILE=preview`. **NO** es `production` (ese es `app-bundle`/AAB para Play Store). ✅ Correcto para QA/piloto, no "producción abierta".
- **App:** name `KOLD Field`, slug `kold-field`, package `mx.grupofrio.koldfield`, version `1.3.1`, versionCode `2`.

## ⚠️ Ambiente / URL — DECISIÓN PENDIENTE (validar antes de compilar)
- `DEFAULT_BASE_URL = EXPO_PUBLIC_KF_DEFAULT_BASE_URL || 'https://grupofrio.odoo.com'` (`src/services/api.ts`).
- El perfil `preview` **NO** define `EXPO_PUBLIC_KF_DEFAULT_BASE_URL`, y el login **hardcodea** `DEFAULT_BASE_URL` (`app/(auth)/login.tsx`) → **el APK se conectará a `grupofrio.odoo.com` (PRODUCCIÓN)**. No existe un Odoo de staging para la app; un piloto de campo necesariamente opera contra el Odoo real.
- **Implicación:** el piloto escribe ventas/inventario/liquidación **reales** en producción. Mitigación: usar empleado/ruta/clientes de prueba, stock controlado y supervisión; recordar que la **barrera dura anti-sobreventa/idempotencia** sigue en backend **#116** (en staging, no desplegado).
- **Si se quiere aislar a otro Odoo:** definir `EXPO_PUBLIC_KF_DEFAULT_BASE_URL` en el perfil `preview` de `eas.json` (env) apuntando a esa URL. (Cambio de config de build, no de features.)

## Comando de build (ejecutar en una máquina con EAS CLI + sesión Expo)
```bash
# desde el repo, en el commit/tag de build:
git fetch --tags && git checkout koldfield-qa-5a3ecdb
npm ci
npx eas-cli@latest login            # cuenta Expo de Grupo Frío
npx eas-cli@latest build -p android --profile preview --no-wait
# (opcional, aislar ambiente) editar eas.json → build.preview.env.EXPO_PUBLIC_KF_DEFAULT_BASE_URL="<url_qa>" antes de build
```
- Resultado: un **APK** descargable desde el dashboard de EAS (`https://expo.dev/accounts/<cuenta>/projects/kold-field/builds`).
- **No** usar `--profile production` (genera AAB para Play Store).

## Evidencia (a completar al ejecutar el build)
| Campo | Valor |
|---|---|
| Commit | `5a3ecdb` (tag `koldfield-qa-5a3ecdb`) |
| Perfil | `preview` (APK, internal) |
| Ambiente/URL | `grupofrio.odoo.com` (prod) salvo override de env |
| Version / versionCode | 1.3.1 / 2 |
| Comando | `eas build -p android --profile preview` |
| Link APK | _(del dashboard EAS al terminar)_ |
| Tamaño / checksum | _(del artefacto EAS)_ |
| typecheck / tests | limpio / 124/124 |

## Checklist QA (instalar y probar en Android de gama baja)
1. [ ] Instala el APK; abre la app.
2. [ ] **Login** con empleado de prueba.
3. [ ] **Preparar ruta/cache** (CEDIS con WiFi): descarga productos/precios; gate "Iniciar ruta".
4. [ ] **Venta + foto** (efectivo/crédito) confirma online.
5. [ ] **ProductPicker sin red**: no se queda cargando; cae a `list_price`.
6. [ ] **insufficient_stock** (si backend lo permite): muestra disponible y refresca stock.
7. [ ] **Regalo offline** y luego **sync** al reconectar.
8. [ ] **No-venta** con foto.
9. [ ] **Refill**: ve todos los productos, agotados primero.
10. [ ] **Consignación** cacheada (abrir online, reabrir sin red).
11. [ ] **Lealtad**: nivel/racha del cliente.
12. [ ] **Liquidación**: confirmar corte → confirmar liquidación (gate de sync).
13. [ ] **Cierre de ruta**: KM final + limpieza de jornada.
14. [ ] **Reinicio en ruta sin red**: productos/precios persisten; cola de sync intacta.
15. [ ] **Drenado de Sync** al reconectar.

## Riesgos pendientes
- **Producción como ambiente del piloto** (arriba) — confirmar con Yamil.
- **#116** (backend) sigue bloqueando producción "abierta": barrera dura de stock + idempotencia cierre/liquidación, pendiente de staging (`KOLDFIELD_BACKEND_B6B7B9_STAGING_TEST_KIT.md`).
- App no bloqueante: login sin detección offline (baja); 2D-2 imágenes (dep B4).

## Próximo paso con Sebastián para #116
Levantar **staging/copia en Odoo.sh** para #116 y correr el kit de 10 casos (stock guard, `insufficient_stock` con `data.lines`, idempotencia cierre/liquidación). Con eso verde → desbloquea producción y completa el detalle por-línea de `insufficient_stock` en la app (ya forward-compatible).
