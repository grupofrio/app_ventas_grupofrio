# Evidencia fotográfica para tickets de cambio — Diseño

**Fecha:** 2026-07-27
**Estado:** Aprobado por el usuario

## Objetivo

Exigir evidencia fotográfica al registrar un cambio de producto y permitir que el vendedor capture varias fotos desde la app. Las fotos deben quedar asociadas a la visita del cliente, conservarse localmente cuando no haya conexión y enviarse automáticamente cuando la sincronización esté disponible.

## Decisiones aprobadas

- Se permiten varias fotos por cambio.
- Se exige un mínimo de una foto para poder confirmar el cambio.
- Las fotos se toman con la cámara existente de la app.
- Las fotos se guardan primero en el almacenamiento local de la aplicación.
- El cambio se registra una sola vez; las fotos se suben después mediante la cola existente.
- Cada foto se identificará como evidencia de cambio con `image_type: 'exchange'`.
- Si no hay internet, las fotos permanecen pendientes y se reintentan sin repetir el cambio.

## Flujo de usuario

1. El vendedor captura los productos entregados, los productos recogidos/merma y las notas.
2. En la sección **Evidencia del cambio**, pulsa **Tomar foto**.
3. La app solicita permiso de cámara cuando sea necesario, toma la fotografía y la guarda localmente.
4. La pantalla muestra el contador de fotos y miniaturas de las evidencias capturadas.
5. El vendedor puede agregar más fotos o eliminar una foto antes de confirmar.
6. El botón de confirmación permanece bloqueado o muestra validación mientras no exista al menos una foto.
7. Al confirmar, la app registra el cambio con la misma clave de idempotencia y, únicamente después de una respuesta exitosa, encola todas las fotos capturadas.
8. La app continúa al ticket de cambio. El estado de sincronización de las evidencias se informa sin solicitar repetir el cambio.

## Modelo y asociación

El formulario mantendrá una colección ordenada de URI locales:

```ts
photoUris: string[];
```

Cada URI será persistido por el servicio de cámara existente y se convertirá en un elemento independiente de la cola:

```ts
{
  type: 'photo',
  payload: {
    stop_id: stopId,
    localUri,
    image_type: 'exchange',
  },
}
```

La asociación operativa será la visita/cliente (`stop_id`) y el backend distinguirá estas cargas por `image_type`. No se enviarán base64 dentro de `gf/salesops/exchange/create`; así se evita hacer pesada o frágil la petición principal.

La evidencia fotográfica formará parte del estado local del formulario mientras se captura, pero no se incorporará al contenido del PDF térmico del ticket en esta primera versión. El ticket seguirá identificando el cambio y el cliente; las fotos quedarán disponibles para el flujo de sincronización de evidencias.

## Componentes y responsabilidades

- `app/exchange/[stopId].tsx`: estado de varias fotos, captura, miniaturas, eliminación, validación mínima y encolado posterior al éxito.
- `src/services/camera.ts`: captura, persistencia y lectura base64; se reutiliza sin cambiar el formato de archivo.
- `src/services/visitPhotos.ts`: encolado de cada evidencia; se reutiliza con `imageType: 'exchange'`.
- `src/stores/useSyncStore.ts`: procesamiento y reintentos de los elementos `photo`; se conserva el mecanismo existente.
- `src/services/gfLogistics.ts`: no requiere cambiar el contrato del cambio; solo debe verificarse que el endpoint de imágenes acepte y conserve el tipo `exchange`.
- `tests/`: pruebas de validación mínima, varias fotos, eliminación, encolado de todas las URI y prevención de reintento del cambio cuando falla una carga fotográfica.

## Errores y estados

- Sin fotos: no se permite registrar el cambio y se muestra un mensaje claro indicando que la evidencia es obligatoria.
- Fallo al tomar una foto: el formulario permanece disponible para reintentar; no se registra el cambio.
- Error del backend del cambio: no se encolan fotos y el vendedor puede corregir o reintentar el formulario.
- Cambio registrado y error al encolar fotos: no se repite el cambio; se informa que el cambio quedó registrado y que las evidencias quedaron pendientes de preparación.
- Sin conexión después del registro: las fotos se conservan como pendientes en la cola local y se reintentan automáticamente.
- Eliminación de una foto: se elimina únicamente la evidencia local seleccionada antes de confirmar; las fotos ya encoladas no se vuelven a registrar desde el formulario.
- La app no enviará una foto parcialmente escrita; la cola leerá el archivo local al procesarla y reportará error si ya no está disponible.

## Verificación

- Una foto es suficiente para habilitar la confirmación.
- Dos o más fotos se encolan individualmente y mantienen el orden de captura.
- El botón no permite confirmar con cero fotos.
- El usuario puede agregar y eliminar fotos antes de confirmar.
- Una respuesta fallida del cambio no genera cargas fotográficas.
- Una respuesta exitosa del cambio no se repite si falla la preparación o carga de fotos.
- Las cargas usan `image_type: 'exchange'` y el `stop_id` correcto.
- `npm test` y `npm run typecheck` pasan sin regresiones.

## Fuera de alcance

- Enviar imágenes dentro de la petición de creación del cambio.
- Mostrar las fotos dentro del PDF o imprimirlas en la MP210.
- Crear un historial independiente de evidencias.
- Cambiar el flujo existente de fotos de venta o no venta.
