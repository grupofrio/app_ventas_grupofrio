# PR-4b Ambiguous Sale Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover an online sale whose response is ambiguous by durably queueing and retrying the exact same `operation_id`, while keeping definitive rejections editable and preventing any pre-persistence dispatch.

**Architecture:** Add structured HTTP error metadata and pure sale-response/outcome classifiers, then make queue insertion accept an explicit operation ID. A transient processing-hold registry gates every queue entry path until a serialized strict persistence barrier saves the sale and photos; the sale screen orchestrates the definitive-versus-ambiguous branches in separate phases.

**Tech Stack:** Expo React Native, TypeScript, Zustand, AsyncStorage, Node's built-in test runner with type stripping, Odoo REST/JSON-RPC envelopes.

**Design spec:** `docs/superpowers/specs/2026-07-20-pr4b-ambiguous-sale-idempotency-design.md`

**Baseline:** `npm test` passes 150 tests and `npm run typecheck` passes at commit `712e2d6` before the design commits.

---

## File map

### New focused modules

- `src/services/apiRequestError.ts` — construct structured response/transport errors without parsing UI text.
- `src/services/saleCreateResult.ts` — validate the unwrapped `{ ok, message, data }` sale response and emit `invalid_response`.
- `src/services/saleSubmissionOutcome.ts` — pure definitive-versus-ambiguous classifier.
- `src/services/syncRetryDecision.ts` — reuse the sale classifier only for queued `sale_order`; preserve existing retry rules for other types.
- `src/services/syncEnqueue.ts` — pure explicit-ID insert/reuse/rearm/collision decision.
- `src/services/syncProcessingHolds.ts` — in-memory hold registry used by candidate selection and post-cycle redrain.
- `src/services/serializedTaskRunner.ts` — serialize critical queue persistence jobs while allowing later jobs to continue after a rejection.
- `src/services/saleAmbiguousRecovery.ts` — enqueue sale/photos under holds, await the durability barrier, then release the group.

### Existing files to modify

- `src/services/api.ts` — attach structured metadata in `postRest` only.
- `src/services/gfLogistics.ts` — validate `createSale` responses against the confirmed envelope.
- `src/types/sync.ts` — shared `SyncEnqueueOptions` type.
- `src/stores/useSyncStore.ts` — explicit-ID decisions, holds, structured sale retryability, serialized strict persistence, and safe background rejection logging.
- `src/services/visitPhotos.ts` — propagate `holdProcessing` to every photo enqueue.
- `app/sale/[stopId].tsx` — phase-limited direct submission, definitive rejection, durable ambiguous recovery, and post-confirmation-only error handling.

### Tests to add or extend

- `tests/apiRequestError.test.ts`
- `tests/apiErrorMetadataWiring.test.mjs`
- `tests/saleCreateResult.test.ts`
- `tests/saleSubmissionOutcome.test.ts`
- `tests/saleCreateContractWiring.test.mjs`
- `tests/syncRetryDecision.test.ts`
- `tests/syncEnqueue.test.ts`
- `tests/syncProcessingHolds.test.ts`
- `tests/syncProcessingHoldWiring.test.mjs`
- `tests/serializedTaskRunner.test.ts`
- `tests/serializedQueuePersistenceWiring.test.mjs`
- `tests/visitPhotos.test.ts`
- `tests/saleAmbiguousRecovery.test.ts`
- `tests/saleAmbiguousRecoveryWiring.test.mjs`

---

### Task 1: Preserve structured metadata from `postRest`

**Files:**
- Create: `src/services/apiRequestError.ts`
- Create: `tests/apiRequestError.test.ts`
- Create: `tests/apiErrorMetadataWiring.test.mjs`
- Modify: `src/services/api.ts:8-56,210-290`

- [ ] **Step 1: Write the failing unit test for response and transport errors**

Create `tests/apiRequestError.test.ts` with cases equivalent to:

```ts
import assert from 'node:assert/strict';

type Mod = typeof import('../src/services/apiRequestError.ts');

function backendError(): Error & { code: string; data: unknown } {
  const error = new Error('Stock insuficiente') as Error & { code: string; data: unknown };
  error.code = 'insufficient_stock';
  error.data = { lines: [{ product_id: 7 }] };
  return error;
}

async function main() {
  const m = await import(
    // @ts-ignore -- Node test runtime supports this ESM path.
    new URL('../src/services/apiRequestError.ts', import.meta.url).pathname
  ) as Mod;

  const response = m.makeApiResponseError(backendError(), 'fallback', 422);
  assert.equal(response.message, 'Stock insuficiente');
  assert.equal(response.httpStatus, 422);
  assert.equal(response.responseReceived, true);
  assert.equal(response.code, 'insufficient_stock');
  assert.deepEqual(response.data, { lines: [{ product_id: 7 }] });
  assert.equal(response.__alreadyLogged, true);

  const codeLess = m.makeApiResponseError(new Error('Validación'), 'fallback', 200);
  assert.equal(codeLess.code, 'api_rejection');

  const timeout = new Error('timeout') as Error & { code: string };
  timeout.code = 'timeout';
  const transport = m.makeApiTransportError(timeout);
  assert.equal(transport.responseReceived, false);
  assert.equal(transport.code, 'timeout');
  assert.equal(transport.httpStatus, undefined);
}

void main();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --experimental-strip-types tests/apiRequestError.test.ts
```

Expected: FAIL because `src/services/apiRequestError.ts` does not exist.

- [ ] **Step 3: Implement the minimal structured-error constructors**

Create `src/services/apiRequestError.ts` with this public shape:

```ts
export interface ApiRequestError extends Error {
  httpStatus?: number;
  responseReceived?: boolean;
  code?: string;
  data?: unknown;
  __alreadyLogged?: boolean;
}

function sourceRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object' ? error as Record<string, unknown> : {};
}

function mutableError(error: unknown, fallbackMessage?: string): ApiRequestError {
  if (error instanceof Error && Object.isExtensible(error)) return error as ApiRequestError;
  const message = error instanceof Error ? error.message : fallbackMessage ?? String(error);
  const copy = new Error(message) as ApiRequestError;
  if (error instanceof Error) copy.name = error.name;
  return copy;
}

export function makeApiResponseError(
  cause: unknown,
  fallbackMessage: string,
  httpStatus: number,
): ApiRequestError {
  const source = sourceRecord(cause);
  const error = mutableError(cause, fallbackMessage);
  error.httpStatus = httpStatus;
  error.responseReceived = true;
  error.code = typeof source.code === 'string' && source.code ? source.code : 'api_rejection';
  if ('data' in source) error.data = source.data;
  error.__alreadyLogged = true;
  return error;
}

export function makeApiTransportError(cause: unknown): ApiRequestError {
  const source = sourceRecord(cause);
  const error = mutableError(cause);
  error.responseReceived = false;
  if (typeof source.code === 'string' && source.code) error.code = source.code;
  if ('data' in source) error.data = source.data;
  return error;
}
```

- [ ] **Step 4: Run the unit test and verify GREEN**

Run the focused command from Step 2.

Expected: PASS.

- [ ] **Step 5: Write the failing wiring test for `postRest`**

Create `tests/apiErrorMetadataWiring.test.mjs` to read `src/services/api.ts`, isolate the `postRest` block, and assert that it:

```js
assert.match(api, /from ['"]\.\/apiRequestError['"]/);
assert.match(postRest, /let resultError:\s*unknown/);
assert.match(postRest, /resultError\s*=\s*error/);
assert.match(postRest, /makeApiResponseError\(resultError,\s*msg,\s*response\.status\)/);
assert.match(postRest, /makeApiTransportError\(error\)/);
```

Also assert that `getRest` still uses its existing handling; PR-4b must not silently broaden the policy to reads.

- [ ] **Step 6: Run the wiring test and verify RED**

Run:

```bash
node --test tests/apiErrorMetadataWiring.test.mjs
```

Expected: FAIL because `postRest` does not import or call the new constructors.

- [ ] **Step 7: Wire the constructors into `postRest`**

In `src/services/api.ts`:

1. Import `makeApiResponseError` and `makeApiTransportError`.
2. Keep `makeLoggedHttpError` for `getRest`/RPC consumers.
3. Add `let resultError: unknown;` beside `errorMessage`.
4. In the `unwrapRestResult` catch, assign both `resultError = error` and `errorMessage`.
5. Replace the response throw with:

```ts
throw makeApiResponseError(resultError, msg, response.status);
```

6. In the outer catch, preserve the `__alreadyLogged` early return. Otherwise create `const requestError = makeApiTransportError(error)`, log its message, and throw `requestError`.

- [ ] **Step 8: Run focused and adjacent tests**

Run:

```bash
node --test --experimental-strip-types tests/apiRequestError.test.ts tests/apiResult.test.ts tests/httpTimeout.test.ts tests/apiErrorMetadataWiring.test.mjs
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/services/apiRequestError.ts src/services/api.ts tests/apiRequestError.test.ts tests/apiErrorMetadataWiring.test.mjs
git commit -m "feat: preserve sale request error metadata"
```

---

### Task 2: Validate sale responses and classify submission outcomes

**Files:**
- Create: `src/services/saleCreateResult.ts`
- Create: `src/services/saleSubmissionOutcome.ts`
- Create: `tests/saleCreateResult.test.ts`
- Create: `tests/saleSubmissionOutcome.test.ts`
- Create: `tests/saleCreateContractWiring.test.mjs`
- Modify: `src/services/gfLogistics.ts:560-570`

- [ ] **Step 1: Write the failing sale-result contract tests**

Cover these inputs in `tests/saleCreateResult.test.ts`:

```ts
const success = {
  ok: true,
  message: 'Venta creada y confirmada.',
  data: { success: true, order_id: 81, operation_id: 'sale-op-1', duplicate: false },
};
assert.equal(m.validateSaleCreateResult(success, 'sale-op-1').order_id, 81);

const duplicate = {
  ok: true,
  data: { success: true, order_id: 81, operation_id: 'sale-op-1', duplicate: true },
};
assert.equal(m.validateSaleCreateResult(duplicate, 'sale-op-1').duplicate, true);
```

For each invalid case (`null`, `{}`, `{ raw: '<html>' }`, `ok !== true`, missing `data`, `data.success !== true`, non-positive/non-integer `order_id`, missing/mismatched `operation_id`), assert that the thrown error has:

```ts
assert.equal(error.code, 'invalid_response');
assert.equal(error.responseReceived, true);
```

- [ ] **Step 2: Write the failing classifier matrix**

In `tests/saleSubmissionOutcome.test.ts`, build errors with optional metadata and assert:

```ts
assert.equal(classify({ httpStatus: 503, code: 'insufficient_stock', responseReceived: true }), 'ambiguous_result');
assert.equal(classify({ responseReceived: false }), 'ambiguous_result');
assert.equal(classify({ code: 'timeout' }), 'ambiguous_result');
assert.equal(classify({ name: 'AbortError' }), 'ambiguous_result');
assert.equal(classify({ code: 'invalid_response', responseReceived: true }), 'ambiguous_result');
assert.equal(classify({ httpStatus: 422, responseReceived: true }), 'definitive_rejection');
assert.equal(classify({ code: 'insufficient_stock', responseReceived: true }), 'definitive_rejection');
assert.equal(classify({ code: 'session_expired', responseReceived: true }), 'definitive_rejection');
assert.equal(classify({ code: 'api_rejection', responseReceived: true }), 'definitive_rejection');
assert.equal(classify(new Error('unknown')), 'ambiguous_result');
```

The helper used by the test should return `.kind` from `classifySaleSubmissionError`.

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
node --test --experimental-strip-types tests/saleCreateResult.test.ts tests/saleSubmissionOutcome.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement `saleCreateResult.ts`**

Implement a record guard, the returned data type, and:

```ts
export function validateSaleCreateResult(
  result: unknown,
  expectedOperationId: string,
): SaleCreateResultData {
  const envelope = asRecord(result);
  const data = asRecord(envelope?.data);
  const orderId = data?.order_id;
  const operationId = typeof data?.operation_id === 'string' ? data.operation_id.trim() : '';
  const expected = expectedOperationId.trim();

  if (
    envelope?.ok !== true ||
    data?.success !== true ||
    typeof orderId !== 'number' ||
    !Number.isInteger(orderId) ||
    orderId <= 0 ||
    !expected ||
    operationId !== expected
  ) {
    const error = new Error('Respuesta inválida al confirmar la venta.') as Error & {
      code: 'invalid_response';
      responseReceived: true;
    };
    error.code = 'invalid_response';
    error.responseReceived = true;
    throw error;
  }

  return data as unknown as SaleCreateResultData;
}
```

The data interface must include `success: true`, `order_id`, `operation_id`, and optional `duplicate`.

- [ ] **Step 5: Implement `saleSubmissionOutcome.ts` with explicit precedence**

Export:

```ts
export type SaleSubmissionOutcomeKind = 'definitive_rejection' | 'ambiguous_result';
export interface SaleSubmissionOutcome { kind: SaleSubmissionOutcomeKind }
export interface SaleSubmissionErrorMetadata {
  httpStatus?: number;
  responseReceived?: boolean;
  code?: string;
  name?: string;
  message?: string;
}
export function readSaleSubmissionErrorMetadata(error: unknown): SaleSubmissionErrorMetadata;
export function classifySaleSubmissionError(error: unknown): SaleSubmissionOutcome;
```

Apply this order:

1. HTTP 500–599 → ambiguous.
2. `responseReceived === false` → ambiguous.
3. `timeout`, `invalid_response`, network/abort codes or names → ambiguous.
4. Network/timeout/abort message patterns → ambiguous.
5. HTTP 400–499 → definitive.
6. `insufficient_stock`, `session_expired`, `api_rejection`, `access_denied`, `validation_error`, `forbidden`, `unauthorized` → definitive.
7. Default → ambiguous.

Do not use localized business-message matching to declare a rejection definitive.

- [ ] **Step 6: Run both tests and verify GREEN**

Run the focused command from Step 3.

Expected: PASS.

- [ ] **Step 7: Write the failing `createSale` wiring test**

Create `tests/saleCreateContractWiring.test.mjs` and assert that the `createSale` function:

- calls `postRest<unknown>`;
- derives the expected operation ID from `body.operation_id`;
- calls `validateSaleCreateResult(result, expectedOperationId)`;
- still returns `true` after validation so its public `Promise<boolean>` contract stays compatible.

- [ ] **Step 8: Run the wiring test and verify RED**

Run:

```bash
node --test tests/saleCreateContractWiring.test.mjs
```

Expected: FAIL because `createSale` still accepts any truthy object.

- [ ] **Step 9: Validate `createSale` without changing other endpoint wrappers**

In `src/services/gfLogistics.ts`, import the validator and change only `createSale`:

```ts
const result = await postRest<unknown>(`${GF_BASE}/sales/create`, body);
const expectedOperationId = typeof body.operation_id === 'string' ? body.operation_id : '';
validateSaleCreateResult(result, expectedOperationId);
return true;
```

- [ ] **Step 10: Run focused, contract, and stock tests**

```bash
node --test --experimental-strip-types tests/saleCreateResult.test.ts tests/saleSubmissionOutcome.test.ts tests/insufficientStock.test.ts tests/gfLogisticsContracts.test.ts tests/saleCreateContractWiring.test.mjs tests/salesMigration.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 11: Commit Task 2**

```bash
git add src/services/saleCreateResult.ts src/services/saleSubmissionOutcome.ts src/services/gfLogistics.ts tests/saleCreateResult.test.ts tests/saleSubmissionOutcome.test.ts tests/saleCreateContractWiring.test.mjs
git commit -m "feat: classify ambiguous sale responses"
```

---

### Task 3: Use structured retry decisions for queued sales

**Files:**
- Create: `src/services/syncRetryDecision.ts`
- Create: `tests/syncRetryDecision.test.ts`
- Modify: `src/stores/useSyncStore.ts:55-61,934-951`

- [ ] **Step 1: Write the failing retry-decision test**

Test this matrix:

```ts
assert.equal(m.shouldRetrySyncItemError('sale_order', withMeta({ code: 'invalid_response' })), true);
assert.equal(m.shouldRetrySyncItemError('sale_order', new Error('unknown')), true);
assert.equal(m.shouldRetrySyncItemError('sale_order', withMeta({ httpStatus: 503 })), true);
assert.equal(m.shouldRetrySyncItemError('sale_order', withMeta({ code: 'insufficient_stock' })), false);
assert.equal(m.shouldRetrySyncItemError('sale_order', withMeta({ httpStatus: 422 })), false);
assert.equal(m.shouldRetrySyncItemError('photo', new Error('Network request failed')), true);
assert.equal(m.shouldRetrySyncItemError('photo', new Error('unknown')), false);
```

- [ ] **Step 2: Run the test and verify RED**

```bash
node --test --experimental-strip-types tests/syncRetryDecision.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the narrow adapter**

Create `src/services/syncRetryDecision.ts`:

```ts
import type { SyncItemType } from '../types/sync';
import { classifySaleSubmissionError } from './saleSubmissionOutcome';
import { isRetryableSyncErrorMessage } from '../utils/syncFailure';

export function shouldRetrySyncItemError(type: SyncItemType, error: unknown): boolean {
  if (type === 'sale_order') {
    return classifySaleSubmissionError(error).kind === 'ambiguous_result';
  }
  const message = error instanceof Error ? error.message : 'Sync error';
  return isRetryableSyncErrorMessage(message);
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

- [ ] **Step 5: Replace only the retry predicate in `processOneItem`**

Import `shouldRetrySyncItemError` and replace:

```ts
const shouldRetry = isRetryableSyncErrorMessage(msg);
```

with:

```ts
const shouldRetry = shouldRetrySyncItemError(item.type, error);
```

Remove the direct `isRetryableSyncErrorMessage` import if it has no remaining use in the store.

- [ ] **Step 6: Run retry and sync regression tests**

```bash
node --test --experimental-strip-types tests/syncRetryDecision.test.ts tests/syncFailure.test.ts tests/saleSubmissionOutcome.test.ts tests/saleRetry.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/services/syncRetryDecision.ts src/stores/useSyncStore.ts tests/syncRetryDecision.test.ts
git commit -m "feat: retry ambiguous queued sales"
```

---

### Task 4: Add explicit queue IDs and transient processing holds

**Files:**
- Modify: `src/types/sync.ts:58-86`
- Create: `src/services/syncEnqueue.ts`
- Create: `src/services/syncProcessingHolds.ts`
- Create: `tests/syncEnqueue.test.ts`
- Create: `tests/syncProcessingHolds.test.ts`
- Create: `tests/syncProcessingHoldWiring.test.mjs`
- Modify: `src/stores/useSyncStore.ts:96-105,144-180,263-328,481-505,616-655`

- [ ] **Step 1: Add failing pure tests for explicit-ID insertion**

In `tests/syncEnqueue.test.ts`, use a `makeItem` helper like `tests/saleRetry.test.ts` and cover:

- no explicit ID uses the injected generated UUID;
- explicit whitespace-normalized ID becomes both `item.id` and `payload._operationId`;
- caller payload cannot override `_operationId`;
- same ID/type in `pending`, `syncing`, `error`, or `done` returns the original queue and payload;
- same ID/type in `dead` rearms only that item to `pending` and clears retry fields without replacing payload;
- same ID/different type throws a collision;
- empty/non-string explicit ID throws instead of falling back to a UUID;
- dependencies are copied rather than aliased.

- [ ] **Step 2: Add failing tests for the hold registry**

In `tests/syncProcessingHolds.test.ts` assert:

```ts
const holds = m.createSyncProcessingHolds();
holds.hold(['sale-1', 'photo-1']);
assert.equal(holds.isHeld('sale-1'), true);
assert.deepEqual(holds.withoutHeld([{ id: 'sale-1' }, { id: 'other' }]), [{ id: 'other' }]);
holds.release(['sale-1']);
assert.equal(holds.isHeld('sale-1'), false);
assert.equal(holds.isHeld('photo-1'), true);
```

Also test idempotent hold/release and ignoring empty IDs.

- [ ] **Step 3: Run both tests and verify RED**

```bash
node --test --experimental-strip-types tests/syncEnqueue.test.ts tests/syncProcessingHolds.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Add the shared enqueue options type**

In `src/types/sync.ts` export:

```ts
export interface SyncEnqueueOptions {
  dependsOn?: string[];
  operationId?: string;
  holdProcessing?: boolean;
}
```

- [ ] **Step 5: Implement the pure enqueue decision**

Create `src/services/syncEnqueue.ts` with:

```ts
export interface ApplySyncEnqueueInput {
  queue: SyncQueueItem[];
  type: SyncItemType;
  payload: Record<string, unknown>;
  options?: SyncEnqueueOptions;
  generatedId: string;
  createdAt: number;
}

export interface ApplySyncEnqueueResult {
  id: string;
  queue: SyncQueueItem[];
  action: 'inserted' | 'reused' | 'rearmed_dead';
}
```

Resolve an explicit ID only when `options.operationId !== undefined`; validate it as a non-empty string. For an existing item, throw on type mismatch, rearm `dead`, otherwise return the original queue. For insertion construct the current `SyncQueueItem` fields, copy `dependsOn`, and force `payload._operationId = id`.

- [ ] **Step 6: Implement the in-memory hold registry**

Create `src/services/syncProcessingHolds.ts`:

```ts
export function createSyncProcessingHolds() {
  const ids = new Set<string>();
  const normalize = (values: string[]) => values.map((id) => id.trim()).filter(Boolean);
  return {
    hold(values: string[]) { for (const id of normalize(values)) ids.add(id); },
    release(values: string[]) { for (const id of normalize(values)) ids.delete(id); },
    isHeld(id: string) { return ids.has(id); },
    withoutHeld<T extends { id: string }>(items: T[]): T[] {
      return items.filter((item) => !ids.has(item.id));
    },
  };
}
```

- [ ] **Step 7: Run pure tests and verify GREEN**

Run the command from Step 3.

- [ ] **Step 8: Write the failing store wiring test for every processor entry path**

Create `tests/syncProcessingHoldWiring.test.mjs` and assert that `useSyncStore.ts`:

- creates one module-level hold registry;
- calls `hold([id])` before publishing a newly inserted/rearmed queue when `opts?.holdProcessing`;
- exposes `releaseProcessingHolds(ids)` without calling `processQueue` itself;
- filters held IDs from `processQueue` candidates;
- passes a held-filtered queue to `decidePostCycleActionAfterCycle`;
- does not rely only on suppressing enqueue's `setTimeout`.

- [ ] **Step 9: Run the wiring test and verify RED**

```bash
node --test tests/syncProcessingHoldWiring.test.mjs
```

Expected: FAIL against the current store.

- [ ] **Step 10: Integrate explicit IDs and holds into `useSyncStore`**

In the store:

1. Change the `enqueue` signature to `opts?: SyncEnqueueOptions` and add `releaseProcessingHolds(ids: string[]): void`.
2. Instantiate one registry outside Zustand state.
3. Preserve GPS-cap eviction, then call `applySyncEnqueue` with `uuid()` and `Date.now()`.
4. When `holdProcessing` is true, call `holds.hold([result.id])` before `set(...)` makes a new/rearmed queue visible.
5. Generate client metadata only for `action === 'inserted'`.
6. Suppress enqueue's auto-trigger when `holdProcessing` is true.
7. In `processQueue`, filter held IDs before `isReady` candidates.
8. In `finally`, pass `holds.withoutHeld(get().queue)` to `decidePostCycleActionAfterCycle`.
9. `releaseProcessingHolds` only removes IDs; it never triggers sync.

- [ ] **Step 11: Run queue, hold, dependency, and wakeup tests**

```bash
node --test --experimental-strip-types tests/syncEnqueue.test.ts tests/syncProcessingHolds.test.ts tests/syncProcessingHoldWiring.test.mjs tests/syncDependencies.test.ts tests/syncWakeup.test.ts tests/saleRetry.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 12: Commit Task 4**

```bash
git add src/types/sync.ts src/services/syncEnqueue.ts src/services/syncProcessingHolds.ts src/stores/useSyncStore.ts tests/syncEnqueue.test.ts tests/syncProcessingHolds.test.ts tests/syncProcessingHoldWiring.test.mjs
git commit -m "feat: hold explicit queue operations until durable"
```

---

### Task 5: Serialize strict queue persistence and expose a real barrier

**Files:**
- Create: `src/services/serializedTaskRunner.ts`
- Create: `tests/serializedTaskRunner.test.ts`
- Create: `tests/serializedQueuePersistenceWiring.test.mjs`
- Modify: `src/stores/useSyncStore.ts:30,96-105,263-328,433-460,616-620,765-819,1235-1242`

- [ ] **Step 1: Write the failing serialization tests**

In `tests/serializedTaskRunner.test.ts`, verify:

1. A second task does not start until a gated first task finishes.
2. The second task observes state read inside its execution, not state captured when requested.
3. If the first task rejects, its returned promise rejects but a queued second task still runs.
4. Completion order is the request order.

Use deferred promises rather than timers so the test is deterministic.

- [ ] **Step 2: Run the test and verify RED**

```bash
node --test --experimental-strip-types tests/serializedTaskRunner.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement a rejection-tolerant serialized runner**

Create `src/services/serializedTaskRunner.ts`:

```ts
export function createSerializedTaskRunner() {
  let tail: Promise<void> = Promise.resolve();

  return function runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

- [ ] **Step 5: Route every sync-queue storage write through one runner**

In `useSyncStore.ts`:

1. Stop using swallowing `storeSave` for `SYNC_QUEUE`; keep `storeSaveStrict`.
2. Create one module-level serialized runner.
3. Implement `persistCurrentQueue()` as a serialized task that reads `useSyncStore.getState().queue` when its turn begins, applies `selectPersistableQueue`, then awaits `storeSaveStrict`.
4. Make the public `persistQueue` return `persistCurrentQueue()` so explicit callers observe rejection.
5. Add `persistQueueInBackground(source)` which calls the same function, catches, and logs `sync_queue_persist_failed` without producing an unhandled rejection.
6. Replace the fire-and-forget calls from the scheduled writer, enqueue, metadata completion, process `finally`, and rollback marker with `persistQueueInBackground`.
7. Route both direct `SYNC_QUEUE` writes in `durableMigrateLegacy` through the same serialized runner. Compute their queue transform inside the serialized task and, after a successful write, apply the equivalent transform to the then-current in-memory queue so concurrent new items are preserved.

Do not change strict persistence of `LEGACY_REFRESH_PENDING`; it is a different key and part of the existing migration protocol.

- [ ] **Step 6: Add source assertions for strict and centralized persistence**

Create `tests/serializedQueuePersistenceWiring.test.mjs` to ensure:

- no `storeSave(STORAGE_KEYS.SYNC_QUEUE` remains;
- all `storeSaveStrict(STORAGE_KEYS.SYNC_QUEUE` calls occur inside the serialized runner callback;
- every fire-and-forget call has an explicit rejection handler;
- the public barrier returns the strict serialized promise.

- [ ] **Step 7: Run persistence and legacy regression tests**

```bash
node --test --experimental-strip-types tests/serializedTaskRunner.test.ts tests/legacyRefillUnloadMigration.test.ts tests/syncWakeup.test.ts tests/storeRequireCycleWiring.test.mjs tests/serializedQueuePersistenceWiring.test.mjs
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/services/serializedTaskRunner.ts src/stores/useSyncStore.ts tests/serializedTaskRunner.test.ts tests/serializedQueuePersistenceWiring.test.mjs
git commit -m "fix: serialize durable sync queue writes"
```

---

### Task 6: Build the held ambiguous-recovery batch

**Files:**
- Modify: `src/services/visitPhotos.ts:1-43`
- Modify: `tests/visitPhotos.test.ts`
- Create: `src/services/saleAmbiguousRecovery.ts`
- Create: `tests/saleAmbiguousRecovery.test.ts`

- [ ] **Step 1: Extend the photo-helper test with held propagation**

Update its enqueue option type to `SyncEnqueueOptions`, call:

```ts
enqueueVisitPhotos({
  stopId: 44,
  photoUris: ['file://one.jpg', 'file://two.jpg'],
  dependsOn: ['sale-op-1'],
  holdProcessing: true,
  enqueue,
});
```

Assert each call receives:

```ts
{ dependsOn: ['sale-op-1'], holdProcessing: true }
```

- [ ] **Step 2: Run the photo test and verify RED**

```bash
node --test --experimental-strip-types tests/visitPhotos.test.ts
```

Expected: FAIL because `holdProcessing` is not accepted or propagated.

- [ ] **Step 3: Propagate the hold option in `visitPhotos.ts`**

Import `SyncEnqueueOptions`, reuse it in `EnqueuePhoto`, add `holdProcessing?: boolean` to the helper input, and construct options whenever dependencies or a hold exist:

```ts
const opts = dependsOn?.length || holdProcessing
  ? { dependsOn, holdProcessing }
  : undefined;
```

Avoid emitting keys with meaningless `undefined` values if existing tests require exact object equality.

- [ ] **Step 4: Run the photo test and verify GREEN**

Run the command from Step 2.

- [ ] **Step 5: Write the failing ambiguous-batch test**

In `tests/saleAmbiguousRecovery.test.ts`, inject fake `enqueue`, `persistQueue`, and `releaseProcessingHolds` functions. Assert:

- `sale_order` receives the original payload plus `_clientCustomerName`/`_clientTotal` and `{ operationId, holdProcessing: true }`;
- every photo depends on the original operation ID and is held;
- `persistQueue` starts only after sale and all photos are in memory;
- no hold is released while a deferred persistence promise is unresolved;
- success releases `[operationId, ...photoIds]` together and returns those IDs;
- persistence rejection releases the same IDs, rethrows, and never reports success;
- the helper has no processor callback, so it cannot dispatch on failure.

- [ ] **Step 6: Run the recovery test and verify RED**

```bash
node --test --experimental-strip-types tests/saleAmbiguousRecovery.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 7: Implement `persistAmbiguousSaleRecovery`**

Create a typed, RN-free service whose core is:

```ts
const saleId = enqueue('sale_order', {
  ...payload,
  _clientCustomerName: customerName,
  _clientTotal: total,
}, { operationId, holdProcessing: true });

const photoIds = enqueueVisitPhotos({
  stopId,
  photoUris,
  enqueue,
  dependsOn: [operationId],
  imageType: 'sale',
  holdProcessing: true,
});

const heldIds = [saleId, ...photoIds];
try {
  await persistQueue();
} catch (error) {
  releaseProcessingHolds(heldIds);
  throw error;
}
releaseProcessingHolds(heldIds);
return { saleId, photoIds };
```

Before persisting, throw if `saleId !== operationId`; this protects the invariant even if a future enqueue implementation regresses.

- [ ] **Step 8: Run helper, queue, and dependency tests**

```bash
node --test --experimental-strip-types tests/saleAmbiguousRecovery.test.ts tests/visitPhotos.test.ts tests/syncEnqueue.test.ts tests/syncProcessingHolds.test.ts tests/syncDependencies.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 6**

```bash
git add src/services/visitPhotos.ts src/services/saleAmbiguousRecovery.ts tests/visitPhotos.test.ts tests/saleAmbiguousRecovery.test.ts
git commit -m "feat: persist ambiguous sales as held batches"
```

---

### Task 7: Integrate definitive and ambiguous phases in the sale screen

**Files:**
- Create: `tests/saleAmbiguousRecoveryWiring.test.mjs`
- Modify: `app/sale/[stopId].tsx:37-53,258-448`
- Verify: `tests/offlineSaleWiring.test.mjs`
- Verify: `tests/saleConfirmFeedback.test.mjs`

- [ ] **Step 1: Write the failing screen wiring test**

Create `tests/saleAmbiguousRecoveryWiring.test.mjs` with a brace-aware block extractor. Assert:

1. Imports exist for `classifySaleSubmissionError`, `persistAmbiguousSaleRecovery`, and `logError`.
2. The `try` containing `await createSale(...)` ends before online photo/ticket work begins.
3. Only the `createSale` catch calls the classifier.
4. The definitive branch calls `unlockSaleConfirm()` and preserves the current `insufficient_stock` detail/refresh.
5. The ambiguous branch awaits `persistAmbiguousSaleRecovery` with the original `operationId`, original payload, all photos, `persistQueue`, and `releaseProcessingHolds`.
6. `processQueue()` occurs after the awaited recovery helper, never inside it or before it.
7. Persistence failure has its own alert, does not call `unlockSaleConfirm`, and returns before navigation.
8. Ambiguous success stores/tickets with the original ID and uses the approved pending copy.
9. Online-success photo/ticket errors are handled after the direct sale is accepted and cannot enqueue `sale_order` or unlock it.

- [ ] **Step 2: Run the wiring test and verify RED**

```bash
node --test tests/saleAmbiguousRecoveryWiring.test.mjs
```

Expected: FAIL because the screen has one broad `try/catch` and no recovery service.

- [ ] **Step 3: Select the new store actions**

Alongside `enqueue`/`isOnline`, select:

```ts
const persistQueue = useSyncStore((s) => s.persistQueue);
const processQueue = useSyncStore((s) => s.processQueue);
const releaseProcessingHolds = useSyncStore((s) => s.releaseProcessingHolds);
```

- [ ] **Step 4: Restrict classification to direct `createSale`**

Use a dedicated block:

```ts
try {
  await createSale(buildSalesCreatePayload(payload));
} catch (error) {
  const outcome = classifySaleSubmissionError(error);
  const metadata = readSaleSubmissionErrorMetadata(error);
  logInfo('general', 'sale_submission_outcome', {
    operation_id: operationId,
    outcome: outcome.kind,
    http_status: metadata.httpStatus,
    code: metadata.code,
  });

  if (outcome.kind === 'definitive_rejection') {
    setSaleSubmitting(false);
    unlockSaleConfirm();
    // Keep the existing insufficient_stock branch and generic rejection alert.
    return;
  }

  // Ambiguous recovery is implemented in Step 5.
}
```

Import `readSaleSubmissionErrorMetadata` from `saleSubmissionOutcome`; never cast and dereference arbitrary `unknown` unsafely.

- [ ] **Step 5: Implement the ambiguous branch with a separate local-recovery catch**

Inside the ambiguous branch:

```ts
try {
  await persistAmbiguousSaleRecovery({
    operationId,
    payload,
    customerName: stop.customer_name,
    total,
    stopId: stop.id,
    photoUris: salePhotoUris,
    enqueue,
    persistQueue,
    releaseProcessingHolds,
  });
} catch (persistenceError) {
  setSaleSubmitting(false);
  logError('sync', 'ambiguous_sale_persist_failed', {
    operation_id: operationId,
    message: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
  });
  Alert.alert(
    'No cierres la aplicación',
    'No pudimos guardar de forma segura el pedido. La operación permanece bloqueada; mantén abierta la aplicación e intenta sincronizar nuevamente.',
  );
  return;
}

void processQueue().catch((processError) => {
  logError('sync', 'ambiguous_sale_process_start_failed', {
    operation_id: operationId,
    message: processError instanceof Error ? processError.message : String(processError),
  });
});
```

Then set `saleOperationId: operationId`, save the ticket with that ID in its own guarded phase, set `saleSubmitting` false, show:

```text
No pudimos confirmar la respuesta del servidor. El pedido quedó pendiente de verificación y se reintentará con el mismo identificador.
```

Apply the same `shouldSkipStopCheckout` decision as the offline pending branch and return so execution never falls into online-success finalization.

- [ ] **Step 6: Separate online-success photos/ticket from direct submission**

After the direct `try/catch` succeeds, perform photo enqueue and ticket persistence in a new guarded block. On failure:

- do not call `unlockSaleConfirm`;
- do not enqueue a `sale_order`;
- log `sale_post_confirmation_failed` with the original operation ID;
- show a warning beginning with “La venta se confirmó”;
- continue to route/checkout navigation because the remote sale is already valid.

Keep `useVisitStore.setState({ saleOperationId: null })`, product refresh, and current navigation behavior on normal online success.

- [ ] **Step 7: Run screen-focused tests**

```bash
node --test tests/saleAmbiguousRecoveryWiring.test.mjs tests/offlineSaleWiring.test.mjs tests/saleConfirmFeedback.test.mjs
node --test --experimental-strip-types tests/saleAmbiguousRecovery.test.ts tests/saleSubmissionOutcome.test.ts tests/insufficientStock.test.ts tests/visitPhotos.test.ts tests/saleTicket.test.ts
npm run typecheck
```

Expected: all PASS. If an old text assertion assumed the broad catch, update only that assertion to the approved phase boundary; do not weaken behavior checks.

- [ ] **Step 8: Commit Task 7**

```bash
git add app/sale/'[stopId].tsx' tests/saleAmbiguousRecoveryWiring.test.mjs
git commit -m "feat: recover ambiguous online sales idempotently"
```

---

### Task 8: Full verification and implementation handoff

**Files:**
- Verify all files changed in Tasks 1–7
- Do not modify the design spec unless implementation proves a genuine contradiction

- [ ] **Step 1: Run formatting/whitespace validation**

```bash
git diff --check main...HEAD
```

Expected: no output.

- [ ] **Step 2: Run the complete test suite**

```bash
npm test
```

Expected: all test files and test cases PASS, zero failures.

- [ ] **Step 3: Run TypeScript verification**

```bash
npm run typecheck
```

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 4: Review the complete diff against the spec**

```bash
git diff --stat main...HEAD
git diff main...HEAD -- src/services/api.ts src/services/gfLogistics.ts src/stores/useSyncStore.ts src/services/visitPhotos.ts app/sale/'[stopId].tsx'
```

Check explicitly:

- success validation uses `{ ok, data }`, not flattened fields;
- 5xx precedence stays ambiguous;
- only `createSale` errors enter the classifier;
- queued sales retain one operation ID;
- held IDs are excluded from candidates and post-cycle redrain;
- barrier uses strict serialized persistence;
- failure releases transient holds without triggering processing;
- non-sale retry behavior and normal offline sale behavior remain unchanged.

- [ ] **Step 5: Perform the deterministic local race review**

Use the new unit tests to verify these sequences without a live backend:

1. processor already running → held recovered IDs stay ineligible;
2. connectivity/manual `processQueue` before barrier → held IDs stay ineligible;
3. barrier success → group releases, explicit process begins;
4. barrier rejection → group releases, no immediate process call;
5. first direct result ambiguous → queued retry uses the identical ID.

Expected: all assertions PASS.

- [ ] **Step 6: Record the optional staging manual test**

When a safe staging Odoo environment is available:

1. intercept/drop the response after Odoo commits a sale;
2. confirm the app shows pending verification with the original operation ID;
3. allow the queue retry;
4. verify Odoo returns the existing order (`data.duplicate: true`);
5. verify one sale, one payment, and one inventory effect.

Do not run this against production and do not block the local PR on unavailable staging access.

- [ ] **Step 7: Request code review before integration**

Use `superpowers:requesting-code-review` against the full branch diff. Resolve any correctness findings, then rerun Steps 1–3.

- [ ] **Step 8: Commit only if verification required test-only corrections**

```bash
git add -u
git commit -m "test: cover ambiguous sale recovery races"
```

Skip this commit when the worktree is already clean.
