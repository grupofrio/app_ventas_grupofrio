# KOLD Field staging release flow

## Objetivo

Definir un flujo simple para un equipo de 3 personas donde `staging` sirva para probar cambios nuevos sin tocar datos de produccion y `production` reciba solo cambios ya validados.

## Ambientes

- `development`
  - uso tecnico local
  - backend por defecto: Odoo staging
  - no se distribuye para QA formal
- `staging`
  - uso interno del equipo
  - backend: `https://odoo-staging.grupofrio.mx`
  - DB: `grupofrio-gf-staging280826-37235488`
- `production`
  - uso operativo real
  - backend: `https://grupofrio-gf.odoo.com`
  - DB: `grupofrio-gf-main-34980678`

## Ramas

- `main` -> `production`
- rama de integracion de trabajo -> `staging`
- feature branches -> merge primero a la rama de integracion

Mientras no se cierre una convencion distinta, este trabajo vive en una rama dedicada y no en `main`.

## Builds

La arquitectura de builds queda separada del proceso de release:

- arquitectura de builds: perfiles EAS por plataforma
- proceso de release: cuándo generar, validar y promover un build

### Android

- `development`: `npm run build:dev:android`
- `staging`: `npm run build:staging:android`
- `production`: `npm run build:prod:android`

### iOS

- `staging`: `npm run build:staging:ios`
  - perfil EAS: `staging-ios`
  - destino: app separada de staging en App Store Connect + TestFlight interno
  - identidad: `mx.grupofrio.koldfield.staging`
- `production`: `npm run build:prod:ios`
  - perfil EAS: `production-ios`
  - destino: app oficial en App Store Connect + TestFlight/Release oficial
  - identidad: `mx.grupofrio.koldfield`

## Perfiles EAS

- `development`
  - solo técnico
  - runtime env: `development`
  - identidad nativa: staging
- `staging-android`
  - APK interno
  - runtime env: `staging`
  - identidad nativa: staging
- `staging-ios`
  - build iOS para TestFlight interno
  - runtime env: `staging`
  - identidad nativa: staging
- `production-android`
  - AAB/APK productivo
  - runtime env: `production`
  - identidad nativa: producción
- `production-ios`
  - build iOS productivo
  - runtime env: `production`
  - identidad nativa: producción

## Identidad por ambiente

- iOS staging bundle id: `mx.grupofrio.koldfield.staging`
- Android staging package: `mx.grupofrio.koldfield.staging`
- Staging app name: `KOLD Field Staging`
- Production app name: `KOLD Field`
- Solo existen 2 identidades instalables:
  - `KOLD Field`
  - `KOLD Field Staging`
- `development` no crea una tercera app; reutiliza la identidad nativa de `staging`.

## Cuándo generar build de staging

- feature lista para QA
- fix relevante
- cambio de login
- cambio de sync o cola offline
- cambio de pricing o contratos con Odoo
- cambio de storage o sesión
- validación en dispositivo real antes de promoción

## Nunca probar primero en producción

- login y autenticación
- sync queue
- pricing
- ventas
- cobro
- cierre de ruta
- inventario
- migraciones de storage local
- cambios de permisos nativos o background tasks

## Promotion gate

Promover a `production` solo si:

1. Android staging APK validado
2. iOS staging build validado
3. backend objetivo confirmado
4. sin bug crítico abierto
5. flujo afectado validado con datos de staging

## Checklist mínimo de QA

- badge visible del ambiente correcto
- login contra backend esperado
- navegación principal operativa
- flujo afectado probado end-to-end
- sin confusión entre build de staging y build de producción

## Verificacion obligatoria antes de una escritura en staging

- Confirmar que la app instalada es `KOLD Field Staging`, no Expo Go ni `KOLD Field` de produccion.
- Confirmar el badge visible `STAGING`.
- Confirmar que la tarjeta `BACKEND STAGING` muestra estado `VERIFIED`.
- Confirmar que el host mostrado es el host aprobado de staging.
- Confirmar que la DB fue resuelta por `GET /current_database` en la sesion actual.
- No permitir que una operacion pendiente de la cola se envie mientras el backend este no verificado.

Dominio de staging autorizado: `https://odoo-staging.grupofrio.mx`. DB configurada: `grupofrio-gf-staging280826-37235488`. El login confirma la DB activa mediante `/current_database`; no omite esa verificación si el servidor devuelve un error.

## Nota operativa

La URL base de staging para la app móvil debe guardarse sin sufijo `/odoo`, porque la app compone rutas como `/web/database/list` y `/api/employee-sign-in` sobre esa base.

## Modo temporal de pruebas Android

`staging-android.env.EXPO_PUBLIC_KF_STAGING_USE_CONFIGURED_DB=true` permite usar la DB configurada sin consultar `/current_database`, por autorización de pruebas. Solo acepta `https://odoo-staging.grupofrio.mx` y `grupofrio-gf-staging280826-37235488`. La UI muestra CONFIGURADA, nunca VERIFIED. Código/PIN, autenticación y permisos del backend siguen siendo obligatorios. Producción e iOS no activan este modo.

Para volver a verificación automática: quitar el flag o ponerlo en `false` y generar un nuevo APK con EAS. La configuración de un APK instalado no cambia al editar eas.json.
