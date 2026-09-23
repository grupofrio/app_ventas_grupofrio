# Variante Android local para KOLD Field

## Objetivo

Permitir instalar en un teléfono una compilación local conectada a Metro sin reemplazar ni desinstalar el APK de producción.

## Diseño

El proyecto conservará `app.json` como configuración base de producción. Un archivo dinámico de configuración de Expo leerá esa base y, únicamente cuando `KF_LOCAL_DEV=1`, cambiará:

- Nombre visible: `KOLD Field Dev`.
- Paquete Android: `mx.grupofrio.koldfield.dev`.
- Esquema de enlace: `kold-field-dev`, para evitar colisiones con producción.

Sin la variable, Expo devolverá la configuración de producción sin cambios: `KOLD Field`, `mx.grupofrio.koldfield` y `kold-field`.

No se cambiarán la URL, base de Odoo, permisos, plugins, versión ni perfiles de EAS. La variante local seguirá conectándose al entorno productivo y se utilizará exclusivamente con los registros QA aislados.

## Flujo de uso

En PowerShell, desde el worktree local:

```powershell
$env:KF_LOCAL_DEV="1"
npm run android -- --device R5CT60ZLR4V
```

La primera ejecución genera e instala el cliente Android de desarrollo. Metro proporciona el JavaScript y Fast Refresh aplica cambios posteriores sin volver a compilar código nativo.

Para una ejecución de producción o una verificación normal se omite la variable, o se elimina de la terminal:

```powershell
Remove-Item Env:KF_LOCAL_DEV -ErrorAction SilentlyContinue
```

## Validación

- `npx expo config --type public` sin la variable debe devolver el nombre y paquete de producción.
- El mismo comando con `KF_LOCAL_DEV=1` debe devolver el nombre, paquete y esquema de desarrollo.
- Las pruebas de continuidad del release deben seguir validando `mx.grupofrio.koldfield`.
- `npm run typecheck` debe continuar pasando.

## Límites

La llave de Google Maps podría estar restringida al paquete de producción. Esto no impide probar permisos, GPS, cámara, ventas y sincronización. Si Maps no carga en la variante local, se deberá autorizar por separado el paquete `.dev` y su certificado debug en Google Cloud.
