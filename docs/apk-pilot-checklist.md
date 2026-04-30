# Checklist piloto APK preview — KOLD Field

> Úsalo cada vez que se entrega un APK preview a un vendedor para validación previa al rollout. Marca cada casilla. Si una falla, **detén el piloto** hasta resolverla. No promuevas el APK a más vendedores hasta cerrar el resultado.
>
> Documento relacionado: [`release-checklist.md`](release-checklist.md) (proceso de generación del APK).

## 1. Datos del piloto

| Campo | Valor |
|-------|-------|
| Vendedor | ____________________________ |
| Plaza / ruta | ____________________________ |
| Fecha del piloto | YYYY-MM-DD |
| Versión APK (`expo.version`) | ____________________________ |
| `versionCode` Android | ____________________________ |
| Perfil EAS | preview |
| Device (marca + modelo) | ____________________________ |
| Versión Android | ____________________________ |
| Quién instaló | ____________________________ |
| Quién validó | ____________________________ |
| Canal de descarga del APK | ____________________________ |
| Hash SHA-256 del APK | ____________________________ |

## 2. Pre-instalación

- [ ] El APK es perfil **`preview` o `production`**. **Nunca** `development` ni el output de `npm run android:dev`.
- [ ] El nombre del archivo sigue la convención: `KOLD-Field-preview-v{versión}-{YYYYMMDD}.apk`
- [ ] El `versionCode` del APK nuevo es **estrictamente mayor** que el del APK previo distribuido. (Si `versionCode` es igual o menor, Android puede rechazar la instalación o instalar una versión incorrecta.)
- [ ] El `package name` coincide con `mx.grupofrio.koldfield` (verificable con `aapt dump badging` o `apksigner verify --print-certs`).
- [ ] La **firma del APK** coincide con la firma del APK anterior (mismo keystore EAS). Si no coincide, Android rechazará la instalación encima del existente.
- [ ] El vendedor tiene credenciales válidas en Odoo (barcode + PIN), confirmadas con dirección.
- [ ] El vendedor tiene un plan asignado para el día del piloto en Odoo.
- [ ] El vendedor tiene un warehouse / camión asignado en Odoo con stock cargado (truck_stock).
- [ ] El vendedor tiene `x_analytic_account_id` (plaza) poblado en `hr.employee`.
- [ ] Hay al menos un cliente de prueba con plaza compatible para validar off-route.

## 3. Instalación en device físico

- [ ] El vendedor / instalador tiene habilitado "Instalar apps de fuentes desconocidas" para el navegador o gestor de archivos.
- [ ] APK descargado al device sin errores.
- [ ] Si ya había un APK previo de KOLD Field, el nuevo se instala **encima** sin pedir desinstalación. (Si pide desinstalar primero, hay drift de firma o `versionCode` y no se debe continuar.)
- [ ] Permisos otorgados al instalar / al primer arranque:
  - [ ] Ubicación (Always y While in Use)
  - [ ] Cámara
  - [ ] Almacenamiento si lo pide
- [ ] App abre sin Metro corriendo en ninguna PC del Grupo. **Cierra Metro / `npm start` antes de probar**.
- [ ] **NO aparece** la pantalla roja "Could not connect to development server" ni la URL `http://localhost:8081/...`.
- [ ] Splash screen y logo KOLD Field se ven correctos.

## 4. Flujo crítico (golden path)

### 4.1 Sesión

- [ ] Login: ingresa barcode + PIN, presiona "Iniciar Sesión", entra al home sin error.
- [ ] Pantalla de inicio se ve completa, sin cuadros vacíos ni errores de fuentes.
- [ ] Force-close de la app y reapertura → entra directo al home sin pedir login (rehydrate funciona).
- [ ] Datos del empleado visibles donde aplique (nombre, plaza).

### 4.2 Plan y catálogo

- [ ] Tab "Ruta" / home muestra las paradas asignadas al vendedor.
- [ ] Si NO hay plan, se muestra EmptyState honesto (no error, no pantalla en blanco).
- [ ] Tab "Inventario" carga el catálogo con stock por producto.
- [ ] Si `has_stock_data === false`, los productos aparecen como "Agotado / referencia" (no como "0 disponibles" engañoso).

### 4.3 Visita y venta

- [ ] Toca primera parada → entra al detalle del cliente.
- [ ] **Check-in**: presiona check-in, GPS se captura, parada cambia a `in_progress`.
- [ ] Selecciona "Venta": entra a la pantalla de captura.
- [ ] Agregar producto: selector funciona, producto agregado, qty editable con +/-.
- [ ] **Foto** obligatoria: se puede tomar y queda visible.
- [ ] **Método de pago**: selecciona efectivo o crédito.
- [ ] Subtotal y total visibles, coherentes con qty × price unitario.
- [ ] Botón "Confirmar venta" se habilita solo cuando hay productos + foto + método de pago + plaza analítica.
- [ ] Confirmar venta: la pantalla regresa al detalle del cliente sin error.
- [ ] La pantalla de **Sync** muestra el item `sale_order` en `pending`, después `syncing`, después `done`.
- [ ] **Stock local** del producto vendido bajó la cantidad correspondiente en el inventario.

### 4.4 Cobro y cierre de visita

- [ ] **Cobro** (si aplica): se captura el monto y método; entra en cola y drena.
- [ ] **Check-out** de la parada: cierra la visita; la parada queda en estado `done`.
- [ ] Al regresar al plan, la siguiente parada está disponible.

## 5. Verificación en Odoo (responsable: dirección / Sebastián)

> Esta sección requiere acceso a `grupofrio.odoo.com` con permisos. Marca solo si se valida en backend.

- [ ] La `sale.order` correspondiente a la venta del piloto **existe** en Odoo.
- [ ] La sale.order tiene `partner_id` correcto (cliente del piloto).
- [ ] Las **líneas** de la sale.order coinciden con lo capturado en la app (product_id + qty).
- [ ] El monto total en Odoo coincide con el monto que mostró la app (server-side recálculo válido).
- [ ] **`analytic_distribution`** correcto: contiene la plaza del vendedor + UN.
- [ ] Si hubo cobro: `account.payment` existe, vinculado a la sale.order, con monto correcto.
- [ ] El **stop / visit** correspondiente está marcado como completado (`done`) en `gf.route.stop`.
- [ ] El `client_operation_id` en backend coincide con el UUID generado en frontend (idempotency).
- [ ] No hay sale.order duplicada por el mismo `client_operation_id`.
- [ ] El stock en Odoo bajó la cantidad correspondiente (validable en `stock.quant` o reportes).

## 6. Edge cases

### 6.1 Sin red

- [ ] Activa modo avión durante la captura de una venta.
- [ ] La app permite confirmar la venta y la encola.
- [ ] La pantalla de Sync muestra el item en `pending`.
- [ ] Al desactivar modo avión, el item drena automáticamente y queda en `done`.
- [ ] No se duplican ventas tras la reconexión.

### 6.2 Foto faltante

- [ ] Intentar confirmar venta sin foto → la app **bloquea** con alerta clara.
- [ ] Al tomar la foto, se habilita el botón Confirmar.

### 6.3 Stock insuficiente

- [ ] Intentar vender más unidades del stock disponible → la app **bloquea** con alerta detallada (producto, pedido, disponible).
- [ ] Al ajustar la cantidad, el botón Confirmar se habilita.

### 6.4 Off-route / visita especial

- [ ] Buscar un cliente fuera del plan del día → el buscador filtra por **plaza del vendedor** (`x_analytic_un_id` en `res.partner`, plan_id=2).
- [ ] El cliente correcto aparece en resultados.
- [ ] Captura de venta off-route funciona end-to-end (sale.order + close de off-route visit en Odoo).

### 6.5 Regalo / muestra

- [ ] Selecciona "Regalo" en la parada.
- [ ] Captura productos + cantidades.
- [ ] Confirma → operación entra en cola y se procesa con éxito.
- [ ] En Odoo, el `gf.salesops.gift` correspondiente existe.
- [ ] Stock local del producto regalado bajó.

### 6.6 Cambio físico

- [ ] Selecciona "Cambio".
- [ ] Captura producto nuevo (entrega) y producto dañado (merma).
- [ ] Confirma → operación entra en cola y se procesa.
- [ ] En Odoo, el exchange existe con picking_delivery + picking_merma.

### 6.7 Crash recovery

- [ ] Force-close abrupto durante una venta encolada (antes de drenar).
- [ ] Reabrir app → la cola persiste; el item sigue en `pending` o se re-procesa.
- [ ] No se pierde la venta capturada.

## 7. Cierre del día

- [ ] **Cierre de caja**: el resumen del día se ve correcto (monto total, número de operaciones, kg, etc.).
- [ ] **Sign out**: cierra sesión limpiamente.
- [ ] La app vuelve a la pantalla de login.
- [ ] No quedan tokens en SecureStore (validable solo si reinstalas — opcional).
- [ ] **Re-login** con el mismo vendedor: entra correctamente, plan vacío o plan del siguiente día (según corresponda).

## 8. UX / rendimiento (cualitativo)

- [ ] La app no se freezea más de 2 segundos en pantallas críticas (home, ruta, venta, sync).
- [ ] Las pantallas se leen bajo luz solar directa.
- [ ] Los botones son grandes y fáciles de tocar con el dedo.
- [ ] Los mensajes de error son humanos, no muestran stack traces.
- [ ] Los iconos y tipografía cargan correctamente (no aparecen cuadrados de fallback).

## 9. Resultado del piloto

Marca **una sola** opción y firma con tu nombre + fecha.

- [ ] **OK rollout** — sin observaciones; el APK puede distribuirse al resto de vendedores siguiendo el `release-checklist`.
- [ ] **OK con observaciones** — el APK funciona pero hay puntos a revisar (anotar abajo). Decisión de rollout pendiente de evaluar las observaciones.
- [ ] **Bloqueado** — el APK presenta fallas críticas. **No distribuir**. Reportar y esperar fix antes de un nuevo piloto.

### Observaciones / hallazgos

```
________________________________________________________________
________________________________________________________________
________________________________________________________________
________________________________________________________________
________________________________________________________________
```

### Pasos siguientes

```
________________________________________________________________
________________________________________________________________
________________________________________________________________
```

### Firmas

| Rol | Nombre | Firma | Fecha |
|-----|--------|-------|-------|
| Vendedor | __________________ | __________________ | YYYY-MM-DD |
| Validador técnico | __________________ | __________________ | YYYY-MM-DD |
| Aprobador de rollout | __________________ | __________________ | YYYY-MM-DD |

---

## Apéndice — En caso de error tras instalar

1. **Pantalla roja "Could not connect to development server"** → el APK es development. Desinstala y reemplaza con uno de perfil `preview`. Ver [`release-checklist.md`](release-checklist.md).
2. **Login falla con "No se pudo conectar"** → DNS, VPN bloqueante, o endpoint Odoo caído. Verifica conexión y reintenta.
3. **Plan vacío inesperado** → revisar logs de la app (pantalla Sync) — buscar `plan_stops_access_denied` o `plan_stops_request_failed` con detalles del backend.
4. **Venta no drena de la cola** → revisar pantalla Sync, identificar item en `error` o `dead`, leer `error_message`. Coordinar con Sebastián si es problema backend.
5. **Stock local divergente del backend** → puede ser drift por sync incompleta; refrescar inventario y comparar.
6. **App crashea al abrir** → coordinar log/dump con Sebastián. No reintentar instalar el mismo APK.

Para cualquier hallazgo crítico, abrir incidencia con: vendedor, fecha, versión APK + versionCode, descripción, screenshot, log de la pantalla Sync, hash SHA-256 del APK.
