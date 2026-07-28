# Evidencia fotográfica para cambios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exigir al menos una foto y permitir varias fotos de evidencia antes de registrar un cambio, conservándolas localmente y encolándolas para sincronización con `image_type: 'exchange'`.

**Architecture:** La pantalla de cambio mantendrá un arreglo de URI persistentes producido por `takePhoto`, mostrará contador, miniaturas y eliminación antes de confirmar. Después de que `createExchange` responda exitosamente, encolará cada URI con `enqueueVisitPhotos` y seguirá al ticket existente; si la cola o el ticket local fallan, el cambio no se repite y se comunica el estado pendiente. Se reutilizan sin cambios `camera.ts`, `visitPhotos.ts` y el procesador `photo` de `useSyncStore`.

**Tech Stack:** Expo Router, React Native, TypeScript, `expo-image-picker`, almacenamiento local de `camera.ts`, cola offline de `useSyncStore`, `node:test` y pruebas de wiring.

---

## Mapa de archivos

### Archivos modificados

- `app/exchange/[stopId].tsx`: estado `photoUris`, captura, miniaturas, eliminación, validación mínima y encolado de evidencias después del éxito del cambio.
- `tests/visitPhotos.test.ts`: cobertura explícita de `imageType: 'exchange'` y varias URI.

### Archivos nuevos

- `tests/exchangeEvidenceWiring.test.mjs`: contrato estructural de la pantalla: cámara, múltiples fotos, mínimo obligatorio, eliminación y encolado posterior al cambio.
- `docs/superpowers/plans/2026-07-27-exchange-evidence-photos.md`: este plan.

### Archivos que no deben cambiar

- `src/services/camera.ts`: ya persiste cada captura como archivo local y expone `deletePhoto`.
- `src/services/visitPhotos.ts`: ya crea un elemento independiente por URI y permite elegir `imageType`.
- `src/stores/useSyncStore.ts`: ya lee `localUri`, convierte a base64 y usa `image_type` al subir.
- `src/services/gfLogistics.ts`: `uploadStopImage` ya acepta un tipo de imagen arbitrario.
- Backend `/stop/images`: dependencia de integración que debe aceptar y conservar `image_type: 'exchange'`; este repositorio no contiene el servicio backend, por lo que la verificación se hará como contrato/smoke check contra el entorno configurado antes de declarar la funcionalidad lista.
- `src/services/exchangeTicket*` y la salida PDF/MP210: las fotos no se agregan al ticket en esta versión.

## Task 1: Escribir las pruebas de evidencia múltiple

**Files:**
- Modify: `tests/visitPhotos.test.ts`
- Create: `tests/exchangeEvidenceWiring.test.mjs`

- [ ] **Step 1: Add the exchange queue coverage**

Agregar a `tests/visitPhotos.test.ts` una prueba que llame `enqueueVisitPhotos` con dos URI, `imageType: 'exchange'` y `stopId: 44`. Debe comprobar que se generan dos elementos `photo`, que ambos conservan su URI y que ambos llevan `image_type: 'exchange'`.

- [ ] **Step 2: Run the focused queue test to verify the contract baseline**

Run: `node --experimental-strip-types --test tests/visitPhotos.test.ts`

Expected: PASS para la utilidad existente; esta prueba documenta que el helper reutilizado ya soporta la nueva evidencia.

- [ ] **Step 3: Write the failing exchange-screen wiring test**

Crear `tests/exchangeEvidenceWiring.test.mjs` leyendo `app/exchange/[stopId].tsx` y verificando explícitamente:

```js
assert.match(source, /takePhoto/);
assert.match(source, /deletePhoto/);
assert.match(source, /photoUris/);
assert.match(source, /photoUris\.length === 0/);
assert.match(source, /enqueueVisitPhotos\(/);
assert.match(source, /imageType:\s*['"]exchange['"]/);
assert.match(source, /photoUris:\s*photoUris/);
assert.match(source, /const persistQueue\s*=\s*useSyncStore\(\(s\)\s*=>\s*s\.persistQueue\)/);
assert.match(source, /await persistQueue\(\)/);
assert.match(source, /Agregar otra foto/);
assert.match(source, /Eliminar/);
```

La prueba debe distinguir la validación previa al `createExchange` y verificar que el encolado y la barrera `persistQueue` aparecen después de la llamada exitosa, no dentro del `catch` del backend. También debe comprobar que la confirmación no queda habilitada con cero fotos mediante una expresión sobre `disabled` o una validación equivalente. Leer además `src/stores/useSyncStore.ts` para verificar que el caso `photo` conserva `payload.image_type` al invocar `uploadStopImage`, cubriendo el camino de reintento sin conexión.

- [ ] **Step 4: Run the new wiring test to verify RED**

Run: `node --test tests/exchangeEvidenceWiring.test.mjs`

Expected: FAIL porque la pantalla de cambio todavía no importa ni administra fotos.

- [ ] **Step 5: Commit the test slice**

```bash
git add tests/visitPhotos.test.ts tests/exchangeEvidenceWiring.test.mjs
git commit -m "test: define exchange evidence photo wiring"
```

## Task 2: Implementar captura y administración de varias fotos

**Files:**
- Modify: `app/exchange/[stopId].tsx`

- [ ] **Step 1: Add photo dependencies and local state**

Importar `Image` desde `react-native`, `takePhoto` y `deletePhoto` desde `src/services/camera`, `enqueueVisitPhotos` desde `src/services/visitPhotos` y `useSyncStore` desde `src/stores/useSyncStore`.

Agregar:

```ts
const [photoUris, setPhotoUris] = useState<string[]>([]);
const enqueue = useSyncStore((s) => s.enqueue);
```

No agregar base64 ni duplicar estado en `useVisitStore`; la pantalla ya es la propietaria del borrador del cambio y `takePhoto` deja cada archivo en almacenamiento persistente.

- [ ] **Step 2: Implement capture and removal handlers**

Agregar `handleAddExchangePhoto` que llame `takePhoto`, agregue `photo.localUri` al final del arreglo y muestre `Alert.alert('Foto requerida', 'No se pudo capturar la foto. Intenta de nuevo.')` si devuelve `null`.

Agregar `handleRemoveExchangePhoto(uri)` que quite únicamente esa URI del estado y ejecute `void deletePhoto(uri)` para no dejar archivos capturados que el usuario descartó antes de registrar el cambio.

- [ ] **Step 3: Add the minimum-photo validation before the backend call**

En `handleSubmit`, después de validar las líneas y antes de `setSaving(true)`, agregar:

```ts
if (photoUris.length === 0) {
  Alert.alert('Evidencia requerida', 'Toma al menos una foto antes de registrar el cambio.');
  return;
}
```

Mantener esta validación antes de `createExchange` para que una captura faltante no genere una operación backend.

- [ ] **Step 4: Enqueue and durably persist all photos only after a successful exchange**

Seleccionar también `persistQueue` desde `useSyncStore`:

```ts
const persistQueue = useSyncStore((s) => s.persistQueue);
```

Después de que `createExchange` termine correctamente, y antes de `saveExchangeTicketSnapshot`, encolar todas las URI en una sola llamada al helper y esperar la barrera estricta de persistencia:

```ts
try {
  enqueueVisitPhotos({
    stopId: currentStop.id,
    photoUris,
    enqueue,
    imageType: 'exchange',
  });
  await persistQueue();
} catch (error) {
  const detail = error instanceof Error ? error.message : undefined;
  Alert.alert(
    'Evidencia pendiente',
    `Cambio registrado, pero las fotos quedaron pendientes de sincronización.${detail ? `\n\nDetalle: ${detail}` : ''}`,
  );
}
```

La llamada y el `await persistQueue()` deben ocurrir antes de `saveExchangeTicketSnapshot`, para que un fallo del snapshot del ticket no salte el encolado de fotos. `persistQueue` es la barrera pública estricta que espera el coordinador de `SYNC_QUEUE`; no confiar únicamente en el `enqueue` fire-and-forget. El bloque debe quedar fuera del `try/catch` que convierte un rechazo de `createExchange` en `Cambio no registrado`; un fallo de fotos nunca debe provocar un segundo cambio. No pasar `dependsOn` porque el cambio ya fue aceptado sincrónicamente por backend; la cola solo debe reintentar las evidencias.

- [ ] **Step 5: Render the evidence section and thumbnails**

Antes del botón `Registrar Cambio`, agregar una sección visual con:

- Título `📸 Evidencia del cambio (obligatoria)`.
- Texto `Mínimo 1 foto. Puedes agregar varias.`.
- Botón `Tomar foto` cuando `photoUris.length === 0`.
- Contador `N fotos capturadas` y botón `Agregar otra foto` cuando exista al menos una.
- `Image` por cada URI con `source={{ uri }}`.
- Acción `Eliminar` por miniatura que llame `handleRemoveExchangePhoto(uri)`.

El botón de registro debe usar `disabled={saving || photoUris.length === 0}` y conservar `loading={saving}`. La sección debe quedar dentro del `ScrollView` y usar estilos locales consistentes con `Card`, `colors`, `radii` y `spacing`.

- [ ] **Step 6: Run the wiring test to verify GREEN**

Run: `node --test tests/exchangeEvidenceWiring.test.mjs tests/exchangeFrontendWiring.test.mjs`

Expected: PASS.

- [ ] **Step 7: Run TypeScript validation**

Run: `npm run typecheck`

Expected: exit 0; en particular deben resolverse los tipos de `Image`, `deletePhoto`, `enqueue` y los estilos de las miniaturas.

- [ ] **Step 8: Commit the implementation slice**

```bash
git add 'app/exchange/[stopId].tsx'
git commit -m "feat: require exchange evidence photos"
```

## Task 3: Verificar regresiones y revisar la integración

**Files:**
- Modify: ninguno esperado.
- Test: `tests/visitPhotos.test.ts`, `tests/exchangeEvidenceWiring.test.mjs`, suite completa.

- [ ] **Step 1: Run focused photo and exchange tests**

Run: `node --experimental-strip-types --test tests/visitPhotos.test.ts tests/exchangeEvidenceWiring.test.mjs tests/exchangeFrontendWiring.test.mjs tests/exchangeTicketWiring.test.mjs`

Expected: PASS; se verifican varias URI, `image_type: 'exchange'`, validación mínima, persistencia estricta de la cola y navegación existente al ticket.

- [ ] **Step 2: Verify the backend image contract**

Confirmar en el entorno de integración configurado que `POST /stop/images` acepta un payload con `stop_id`, `image_base64` y `image_type: 'exchange'`, y que la respuesta es exitosa sin normalizar el tipo a `visit`. Si el backend usa una lista cerrada de tipos o no conserva `exchange`, detener el cierre de esta rama y solicitar el cambio de contrato backend; no sustituirlo silenciosamente por `visit`, porque perdería la clasificación de evidencia del cambio.

- [ ] **Step 3: Run the complete JavaScript/TypeScript test suite**

Run: `npm test`

Expected: PASS for all tests, with the baseline count of 479 increasing only by the new assertions/tests.

- [ ] **Step 4: Run final typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Inspect the final diff and status**

Run: `git diff main...HEAD --stat` and `git status --short`

Expected: solo aparecen la pantalla de cambio, las pruebas de evidencia y el plan/documentación propios de esta funcionalidad; no se modifican los archivos no relacionados del worktree.

- [ ] **Step 6: Commit any test-only adjustment if needed**

Si la verificación requiere una corrección de pruebas o un ajuste de copy que no pueda entrar en los commits anteriores:

```bash
git add tests/visitPhotos.test.ts tests/exchangeEvidenceWiring.test.mjs
git commit -m "test: harden exchange evidence coverage"
```

## Verification checklist

- [ ] `npm test` pasa sin regresiones.
- [ ] `npm run typecheck` pasa.
- [ ] Cero fotos bloquea el registro.
- [ ] Una foto habilita el registro.
- [ ] Varias fotos se muestran y se encolan individualmente en orden.
- [ ] El usuario puede eliminar una miniatura antes de confirmar.
- [ ] Un rechazo de `createExchange` no encola fotos.
- [ ] Un fallo al encolar fotos no repite el cambio y deja aviso de evidencia pendiente.
- [ ] Las fotos usan `localUri` y `image_type: 'exchange'`; nunca se guardan base64 en la cola.
- [ ] El ticket PDF/MP210 existente conserva su comportamiento y no incluye fotos en esta versión.

@superpowers:test-driven-development
@superpowers:verification-before-completion
