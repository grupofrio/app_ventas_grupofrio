# KoldField — QA Regalo offline (cola de sincronización)

**Rama:** `fix/koldfield-gift-offline-queue`
**Base:** `main` @ `e804ae3`.
**Alcance:** que el registro de **regalo/muestra** no se pierda sin red — encolarlo de forma segura siguiendo el patrón de venta/no-venta/checkout. **Frontend-only; sin backend; `operation_id` ya existía como `meta.idempotency_key`.**

## Causa del bug
`app/gift/[stopId].tsx` llamaba `createGift(payload)` y, ante cualquier fallo (incluido **sin red**), caía a `catch → Alert('Regalo rechazado')` **sin encolar** → se **perdía la captura** en ruta. Además el `idempotency_key` se generaba **en cada intento** (`makeAttemptId()` por llamada), así que un reintento manual usaba un id nuevo (el backend no podía deduplicar). La sync queue **no tenía dispatcher `gift`**, por lo que ni siquiera era posible encolarlo.

## Cambios
1. **`src/types/sync.ts`**: nuevo tipo `'gift'` en `SyncItemType` + prioridad 1 en `SYNC_PRIORITY_MAP` (operación de negocio).
2. **`src/stores/useSyncStore.ts`**: nuevo **dispatcher `case 'gift'`** → `createGift(payload)` (postea a `/gf/salesops/gift/create`). El payload encolado ES el `{meta, data}` de `buildGiftPayload`; idempotencia por `meta.idempotency_key`.
3. **`src/services/giftSubmit.ts`** (NUEVO, puro): `decideGiftFailureAction({isSessionExpired, isRetryable})` → `'session_relogin' | 'enqueue' | 'show_error'`.
4. **`app/gift/[stopId].tsx`**:
   - **`operation_id` estable** vía `useRef` (mismo `idempotency_key` para el intento online y el encolado; se regenera tras éxito/encolado) → retry no duplica.
   - **Guard doble-tap** (`if (submitting) return`).
   - **Offline-first**: si `!isOnline` → encola directo + "Regalo guardado para sincronizar" + navega.
   - **Catch clasificado**: sesión expirada → pide re-login (NO encola); red/retryable → encola + aviso "Sincronización pendiente"; validación/backend → muestra error (NO encola).
   - Comportamiento online OK **sin cambios** (registra y navega).
5. **Tests** (`tests/giftSubmit.test.ts`): decisión (sesión/retryable/fatal) + idempotencia del payload (mismo `idempotencyKey` → payload idéntico).

## Pruebas manuales
- [ ] **Regalo con red (OK):** registra → navega con mensaje del backend; **no** encola.
- [ ] **Regalo sin red:** se encola; mensaje "Regalo guardado para sincronizar"; navega; aparece en cola de sync.
- [ ] **Reconectar y sincronizar:** al volver online (o "Sincronizar pendientes" en Corte de Caja) el regalo se postea a `/gf/salesops/gift/create`.
- [ ] **Error backend (validación, p.ej. stock/permiso):** muestra "Regalo rechazado: <msg>"; **NO** encola.
- [ ] **Sesión expirada (401):** muestra "Sesión expirada, vuelve a iniciar sesión"; **NO** encola.
- [ ] **Evitar duplicados:** doble-tap → un solo registro (guard + botón disabled). Reintento del mismo borrador usa el **mismo `idempotency_key`** → backend deduplica.
- [ ] **Stock/validación local previa** (sin red insuficiente, duplicados, plaza/ubicación faltante) sigue bloqueando con su mensaje, igual que antes.

## Pruebas automáticas (node)
- `tests/giftSubmit.test.ts` — decisión de fallo (3 casos) + idempotencia del payload. **typecheck limpio; tests 120/120.**

## Riesgos / notas
- El dispatcher `gift` reusa `createGift` (mismo endpoint y contrato; sin cambios de API). La cola de sync ya añade su `_operationId` por ítem; el `idempotency_key` del payload es a nivel de intento del vendedor (el backend de `/gf/salesops/gift/create` ya lee `meta.idempotency_key`).
- Si un regalo encolado es **rechazado por el backend** al sincronizar (no-retryable), seguirá el flujo normal de la cola (error → reintentos → dead), visible en la pantalla de Sync. No hay rollback de inventario local para regalo (no descuenta stock local en el momento; el backend baja a merma de la van al confirmar).
- No se tocó venta/no-venta/checkout ni el placeholder de Lealtad.

## Fuera de alcance
Backend de `gift/create`, placeholder Lealtad, 2D-2 imágenes.
