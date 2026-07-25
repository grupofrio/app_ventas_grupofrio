# KoldField Odoo Ticket Folio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print the authoritative Odoo sale folio when available, otherwise print a clear pending state plus the local reference, while preserving the authoritative seller when reopening a ticket from Ventas.

**Architecture:** Keep `saleId` as the immutable local storage/idempotency key and add nullable `odooFolio` to the ticket snapshot. Promote that field from the validated sale-creation response in both online and queued flows, with monotonic storage semantics. Centralize folio presentation and carry the same result through the preview, HTML/PDF, TypeScript thermal DTO, and Kotlin MP210 layout.

**Tech Stack:** React Native, Expo Router, TypeScript, AsyncStorage-backed persistence, Node test runner, Kotlin/Expo Module API, Android Gradle/JUnit.

**Repository/worktree:** `/Users/sebis/Desktop/app-ventas-v2/.worktrees/odoo-ticket-folio`

**Backend prerequisite:** The app remains compatible without the new
`employee_name` field, but the seller fix when reopening from Ventas requires
the backend plan `2026-07-24-odoo-sales-list-seller.md` to be deployed first.

---

## Preparation: use only the isolated frontend worktree

The primary checkout at `/Users/sebis/Desktop/app-ventas-v2` contains unrelated
work on `codex/offline-sale-continuity`. Do not modify, stage, merge, or clean
that checkout.

- [ ] Run every frontend command in this plan from:

```text
/Users/sebis/Desktop/app-ventas-v2/.worktrees/odoo-ticket-folio
```

- [ ] Verify the isolated branch and its starting state:

```bash
git branch --show-current
git status --short
```

Expected: branch `codex/odoo-ticket-folio`; only the changes belonging to the
current plan may appear.

---

## File map

- Modify `src/services/saleTicket.ts`: add `odooFolio`, normalization, promotion, order merge, and shared presentation.
- Modify `src/persistence/storage.ts`: add strict reads for critical ticket promotion.
- Modify `src/services/saleTicketStorage.ts`: migrate old snapshots, make folio persistence monotonic, and promote queued tickets.
- Modify `src/services/saleRecoveryIntent.ts`: accept legacy snapshots and preserve nullable folio.
- Modify `src/services/saleCreateResult.ts`: require and return Odoo `name`.
- Modify `src/services/gfLogistics.ts`: return validated sale data instead of boolean.
- Modify `src/stores/useSyncStore.ts`: promote the stored ticket after queued sale success.
- Modify `app/sale/[stopId].tsx`: promote online tickets from the create result.
- Modify `app/(tabs)/sales.tsx`: merge Odoo folio and authoritative seller into existing snapshots.
- Modify `app/print/[orderId].tsx`: show the shared folio presentation without blocking outputs.
- Modify `src/services/thermalTicketDocument.ts`, `src/services/thermalPrinterTypes.ts`, and `src/services/thermalPrinter.ts`: carry and preserve the pending local reference across the TypeScript/native boundary.
- Modify `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterRecords.kt`: validate optional local reference.
- Modify `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt`: draw `Folio Odoo` and conditional `Referencia local`.
- Extend the matching TypeScript, wiring, Kotlin record, and Kotlin layout tests.

### Task 1: Separate local identity from Odoo folio

**Files:**
- Modify: `tests/saleTicket.test.ts`
- Modify: `src/services/saleTicket.ts`

- [ ] **Step 1: Write failing snapshot and presentation tests**

Add tests proving:

```typescript
const pending = buildSaleTicketSnapshot({
  saleId: 'mobile-op-1',
  customerName: 'Cliente',
  sellerName: 'Vendedor',
  paymentMethod: 'cash',
  createdAt: '2026-07-24T12:00:00.000Z',
  lines: [{ productId: 1, productName: 'Hielo', qty: 1, price: 20, weight: 5 }],
});

assert.equal(pending.odooFolio, null);
assert.deepEqual(getSaleTicketFolioPresentation(pending), {
  odooFolio: 'Pendiente por sincronizar',
  localReference: 'mobile-op-1',
});

const promoted = withSaleTicketOdooFolio(pending, '  S00042  ');
assert.equal(promoted.saleId, 'mobile-op-1');
assert.equal(promoted.odooFolio, 'S00042');
assert.deepEqual(getSaleTicketFolioPresentation(promoted), {
  odooFolio: 'S00042',
  localReference: null,
});
```

Extend `buildSaleTicketSnapshotFromOrder` tests to require:

```typescript
assert.equal(snapshot.saleId, 'sale_abc');
assert.equal(snapshot.odooFolio, 'S00042');
```

Add empty-name coverage: `order.name = '   '` produces `odooFolio: null`.

- [ ] **Step 2: Run the test and verify RED**

```bash
node --test tests/saleTicket.test.ts
```

Expected: TypeScript import/field assertions fail because the new API does not
exist.

- [ ] **Step 3: Implement the minimal ticket-domain API**

In `SaleTicketSnapshot`, add:

```typescript
odooFolio: string | null;
```

In `BuildSaleTicketSnapshotInput`, add optional:

```typescript
odooFolio?: string | null;
```

Add:

```typescript
export const ODOO_FOLIO_PENDING_LABEL = 'Pendiente por sincronizar';

export function normalizeOdooFolio(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function withSaleTicketOdooFolio(
  snapshot: SaleTicketSnapshot,
  value: unknown,
): SaleTicketSnapshot {
  const odooFolio = normalizeOdooFolio(value);
  return odooFolio === null ? snapshot : { ...snapshot, odooFolio };
}

export function getSaleTicketFolioPresentation(snapshot: SaleTicketSnapshot) {
  return snapshot.odooFolio
    ? { odooFolio: snapshot.odooFolio, localReference: null }
    : {
        odooFolio: ODOO_FOLIO_PENDING_LABEL,
        localReference: snapshot.saleId,
      };
}
```

Set `odooFolio: normalizeOdooFolio(input.odooFolio)` in
`buildSaleTicketSnapshot`. Pass `order.name` as `odooFolio` from
`buildSaleTicketSnapshotFromOrder`. Keep `saleId` unchanged.

- [ ] **Step 4: Verify GREEN**

```bash
node --test tests/saleTicket.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/saleTicket.ts tests/saleTicket.test.ts
git commit -m "feat: separate Odoo ticket folio"
```

### Task 2: Migrate and monotonically persist ticket snapshots

**Files:**
- Create: `tests/saleTicketStorage.test.ts`
- Modify: `tests/legacyRefillUnloadWiring.test.mjs`
- Modify: `src/persistence/storage.ts`
- Modify: `src/services/saleTicketStorage.ts`
- Modify: `tests/saleRecoveryIntent.test.ts`
- Modify: `src/services/saleRecoveryIntent.ts`
- Modify: `tests/saleRehydrateRecovery.test.ts`
- Modify: `tests/visitPersistence.test.ts`
- Modify: `tests/visitState.test.ts`
- Modify: `tests/visitStatePersistence.test.ts`

- [ ] **Step 1: Write failing pure persistence tests**

Export a pure helper `mergeStoredSaleTicketSnapshot(current, incoming)` and test:

```typescript
assert.equal(
  mergeStoredSaleTicketSnapshot(
    { ...base, odooFolio: 'S00042' },
    { ...base, odooFolio: null },
  ).odooFolio,
  'S00042',
);

assert.equal(
  mergeStoredSaleTicketSnapshot(
    { ...base, odooFolio: 'S00042' },
    { ...base, odooFolio: 'S00043' },
  ).odooFolio,
  'S00043',
);
```

Test `normalizeStoredSaleTicketSnapshot` with a legacy object that has no
`odooFolio`; expect `odooFolio: null` and the existing seller fallback.

Test `promoteStoredSaleTicketOdooFolio` with injected `load`/`save` functions:

```typescript
assert.equal(await promote(...existing...), 'updated');
assert.equal(saved?.odooFolio, 'S00042');
assert.equal(await promote(...missing...), 'missing');
await assert.rejects(() => promote(...loadThrows...));
await assert.rejects(() => promote(...saveThrows...));
```

Extend the strict-storage wiring test to require:

```typescript
export async function storeLoadStrict<T>(key: string): Promise<T | null>
```

and prove structurally that it awaits `AsyncStorage.getItem`, returns `null`
only for a real missing key, parses the JSON, and has no catch that converts a
storage/parse failure into `null`.

Add a deferred-storage race test. Start an official-folio save and a pending
save for the same `saleId` without awaiting either one, deliberately release
the raw storage promises in the order that would overwrite the official folio
without serialization, then assert the stored snapshot still contains
`S00042`.

- [ ] **Step 2: Extend recovery-intent compatibility tests**

Require `restoreSaleRecoveryIntent` to:

- accept an old persisted snapshot with no `odooFolio` and restore it as `null`;
- preserve `odooFolio: null`;
- preserve a non-empty Odoo folio;
- reject non-string, non-null folio values.

- [ ] **Step 3: Run tests and verify RED**

```bash
node --test \
  tests/saleTicketStorage.test.ts \
  tests/saleRecoveryIntent.test.ts \
  tests/legacyRefillUnloadWiring.test.mjs
```

Expected: failures for missing migration, merge, promotion, and recovery fields.

- [ ] **Step 4: Implement migration, merge, and promotion**

In `saleTicketStorage.ts`, implement:

```typescript
export function normalizeStoredSaleTicketSnapshot(
  snapshot: SaleTicketSnapshot | (Omit<SaleTicketSnapshot, 'odooFolio'> & {
    odooFolio?: unknown;
  }),
): SaleTicketSnapshot {
  return {
    ...snapshot,
    odooFolio: normalizeOdooFolio(snapshot.odooFolio),
    sellerName: normalizeSellerName(snapshot.sellerName),
  };
}

export function mergeStoredSaleTicketSnapshot(
  current: SaleTicketSnapshot | null,
  incoming: SaleTicketSnapshot,
): SaleTicketSnapshot {
  const normalizedIncoming = normalizeStoredSaleTicketSnapshot(incoming);
  if (!current) return normalizedIncoming;
  const normalizedCurrent = normalizeStoredSaleTicketSnapshot(current);
  return {
    ...normalizedIncoming,
    odooFolio: normalizedIncoming.odooFolio ?? normalizedCurrent.odooFolio,
  };
}
```

Import `normalizeSellerName` explicitly from `saleTicketFormatting.ts`.

In `storage.ts`, add the strict read counterpart beside the existing strict
save/remove functions:

```typescript
export async function storeLoadStrict<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(`${PREFIX}${key}`);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}
```

The existing tolerant `storeLoad` remains unchanged for noncritical UI reads.

Define one injectable adapter shared by both critical ticket write paths:

```typescript
export interface SaleTicketStorageAdapter {
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, data: T): Promise<void>;
}

const strictSaleTicketStorage: SaleTicketStorageAdapter = {
  load: storeLoadStrict,
  save: storeSaveStrict,
};
```

Serialize every read-modify-write operation through one module-level keyed
promise tail:

```typescript
const saleTicketWriteTails = new Map<string, Promise<void>>();

function runSerializedSaleTicketWrite<T>(
  saleId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = saleTicketWriteTails.get(saleId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  saleTicketWriteTails.set(saleId, tail);
  return result.finally(() => {
    if (saleTicketWriteTails.get(saleId) === tail) {
      saleTicketWriteTails.delete(saleId);
    }
  });
}
```

Make `saveSaleTicketSnapshot` enter this critical section, load the current raw
value, merge, and write once. Its optional adapter parameter defaults to
`strictSaleTicketStorage`, giving the deferred race test a deterministic seam.
Keep the same storage key based on `saleId`.

Add:

```typescript
export async function promoteStoredSaleTicketOdooFolio(
  saleId: string,
  odooFolio: string,
  storage: SaleTicketStorageAdapter = strictSaleTicketStorage,
): Promise<'updated' | 'missing'> {
  return runSerializedSaleTicketWrite(saleId, async () => {
    const key = getSaleTicketStorageKey(saleId);
    const current = await storage.load<SaleTicketSnapshot>(key);
    if (!current) return 'missing';
    await storage.save(
      key,
      mergeStoredSaleTicketSnapshot(
        current,
        withSaleTicketOdooFolio(current, odooFolio),
      ),
    );
    return 'updated';
  });
}
```

Promotion must not call public `saveSaleTicketSnapshot` from inside the
critical section, which would recursively acquire the same key and deadlock.
Both public write paths use the same keyed serializer and the same strict
adapter contract. Real read, JSON parse, and write failures reject so queue
processing remains retryable; only a successful strict read returning no value
produces `'missing'`. Failures settle the tail and do not poison later writes.

Update `saleRecoveryIntent.ts` so a missing legacy field becomes `null`, a
present field is `null` or a normalized non-empty string, and invalid types
return `null` for the whole intent.

- [ ] **Step 5: Update compile-time snapshot fixtures**

Add `odooFolio: null` or the explicit official value to the current-version
snapshot literals in:

- `tests/saleRecoveryIntent.test.ts`;
- `tests/saleRehydrateRecovery.test.ts`;
- `tests/visitPersistence.test.ts`;
- `tests/visitState.test.ts`;
- `tests/visitStatePersistence.test.ts`.

Do not add the field to the one legacy-persistence fixture whose purpose is to
prove that records written by older app versions still load.

- [ ] **Step 6: Verify GREEN**

Run the two-test command from Step 3.

Then run:

```bash
npm run typecheck
```

Expected: all tests pass and every non-legacy typed fixture compiles.

- [ ] **Step 7: Commit**

```bash
git add \
  src/services/saleTicketStorage.ts \
  src/services/saleRecoveryIntent.ts \
  src/persistence/storage.ts \
  tests/saleTicketStorage.test.ts \
  tests/saleRecoveryIntent.test.ts \
  tests/legacyRefillUnloadWiring.test.mjs \
  tests/saleRehydrateRecovery.test.ts \
  tests/visitPersistence.test.ts \
  tests/visitState.test.ts \
  tests/visitStatePersistence.test.ts
git commit -m "feat: persist Odoo ticket folio safely"
```

### Task 3: Preserve `name` from the sale-creation response

**Files:**
- Modify: `tests/saleCreateResult.test.ts`
- Modify: `tests/saleCreateContractWiring.test.mjs`
- Modify: `src/services/saleCreateResult.ts`
- Modify: `src/services/gfLogistics.ts`

- [ ] **Step 1: Write failing response-contract tests**

Add `name: 'S00042'` to valid new and duplicate fixtures and assert it is
returned. Add invalid cases for missing, empty, whitespace, and non-string
`data.name`.

Update wiring expectations from:

```typescript
validateSaleCreateResult(result, expectedOperationId);
return true;
```

to:

```typescript
return validateSaleCreateResult(result, expectedOperationId);
```

- [ ] **Step 2: Verify RED**

```bash
node --test \
  tests/saleCreateResult.test.ts \
  tests/saleCreateContractWiring.test.mjs
```

Expected: missing-name invalid cases are accepted and wiring still returns
boolean.

- [ ] **Step 3: Implement the validated result**

Add to `SaleCreateResultData`:

```typescript
name: string;
```

Require `data.name.trim().length > 0` while preserving the backend value or
returning a defensive normalized copy. Prefer returning:

```typescript
return { ...data, name: data.name.trim() } as SaleCreateResultData;
```

Change `createSale` to:

```typescript
export async function createSale(...): Promise<SaleCreateResultData> {
  // existing request
  return validateSaleCreateResult(result, expectedOperationId);
}
```

- [ ] **Step 4: Verify GREEN and typecheck**

```bash
node --test \
  tests/saleCreateResult.test.ts \
  tests/saleCreateContractWiring.test.mjs
npm run typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add \
  src/services/saleCreateResult.ts \
  src/services/gfLogistics.ts \
  tests/saleCreateResult.test.ts \
  tests/saleCreateContractWiring.test.mjs
git commit -m "feat: return Odoo sale reference"
```

### Task 4: Promote online and queued tickets

**Files:**
- Modify: `tests/offlineSaleWiring.test.mjs`
- Modify: `tests/saleAmbiguousRecoveryWiring.test.mjs`
- Create: `tests/syncSaleTicketFolioWiring.test.mjs`
- Modify: `app/sale/[stopId].tsx`
- Modify: `src/stores/useSyncStore.ts`

- [ ] **Step 1: Write failing online-flow wiring assertions**

Require the online path to capture:

```typescript
const saleResult = await createSale(buildSalesCreatePayload(payload));
const confirmedTicketSnapshot = withSaleTicketOdooFolio(
  recoveryIntent.ticketSnapshot,
  saleResult.name,
);
```

Require the post-confirmation save to use `confirmedTicketSnapshot`, while
offline and ambiguous pre-confirmation saves continue using the pending
`recoveryIntent.ticketSnapshot`.

- [ ] **Step 2: Write failing queue-ordering assertions**

For both the offline and ambiguous-response paths, require:

```typescript
await saveSaleTicketSnapshot(recoveryIntent.ticketSnapshot);
await persistAmbiguousSaleRecovery(...);
```

The pending ticket must be durably saved before
`persistAmbiguousSaleRecovery()` releases queue processing holds. In the
ambiguous-response path, also assert that both operations finish before
`processQueue()` starts. Remove the later duplicate pending-ticket save.

This ordering ensures a queued retry cannot receive the Odoo folio while the
ticket is still absent, then complete before the UI writes a stale pending
snapshot.

- [ ] **Step 3: Write failing queued-flow promotion assertions**

For `case 'sale_order'`, require:

```typescript
const saleResult = await createSale(...);
const promotion = await promoteStoredSaleTicketOdooFolio(item.id, saleResult.name);
if (promotion === 'missing') {
  logWarn(...);
}
```

The missing result must not throw. A rejected load/save promise must propagate
out of `processSyncItem`, leaving the item retryable under existing queue error
handling. The non-blocking `missing` result remains a recovery escape hatch for
confirmed legacy/corrupt storage absence; it is not the normal new-sale path.

- [ ] **Step 4: Verify RED**

```bash
node --test \
  tests/offlineSaleWiring.test.mjs \
  tests/saleAmbiguousRecoveryWiring.test.mjs \
  tests/syncSaleTicketFolioWiring.test.mjs
```

Expected: missing captured result and promotion calls.

- [ ] **Step 5: Implement online promotion**

Import `withSaleTicketOdooFolio`, capture the `createSale` result, build
`confirmedTicketSnapshot`, and save it only after a confirmed online response.
Do not change the pending snapshot in the durable recovery intent.

- [ ] **Step 6: Fix queue release ordering**

In both offline and ambiguous-response branches, save the pending snapshot
before calling `persistAmbiguousSaleRecovery`. Preserve the current durable
confirmation lock, idempotent operation ID, error handling, and queue payload.
Only call `processQueue()` after the pending save and queue persistence have
both succeeded.

- [ ] **Step 7: Implement queue promotion**

Import `promoteStoredSaleTicketOdooFolio` in `useSyncStore.ts`. Capture the sale
result, await promotion before returning from the `sale_order` case, and emit a
sanitized `logWarn` containing only `operation_id` when the snapshot is absent.

- [ ] **Step 8: Verify GREEN**

Run the three-test command from Step 3 and:

```bash
npm run typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add \
  app/sale/[stopId].tsx \
  src/stores/useSyncStore.ts \
  tests/offlineSaleWiring.test.mjs \
  tests/saleAmbiguousRecoveryWiring.test.mjs \
  tests/syncSaleTicketFolioWiring.test.mjs
git commit -m "feat: promote synced ticket folio"
```

### Task 5: Refresh folio and seller from Ventas

**Files:**
- Modify: `tests/saleTicket.test.ts`
- Modify: `tests/saleTicketWiring.test.mjs`
- Modify: `src/services/saleTicket.ts`
- Modify: `app/(tabs)/sales.tsx`

- [ ] **Step 1: Write a failing order-merge test**

Add a pure helper test:

```typescript
const merged = mergeSaleTicketFromOrder(existing, {
  ...order,
  name: 'S00042',
  employee_name: 'María López',
});

assert.equal(merged.saleId, existing.saleId);
assert.equal(merged.odooFolio, 'S00042');
assert.equal(merged.sellerName, 'María López');
assert.deepEqual(merged.lines, existing.lines);
```

Add a second case where `employee_name` is blank: preserve a meaningful
existing seller; if no existing snapshot, use `Vendedor no especificado`.
Add a third case where `order.name` is blank but the current snapshot already
has `odooFolio: 'S00042'`; the merge must preserve `S00042`.

- [ ] **Step 2: Add failing screen wiring assertions**

Require `openTicketForOrder` to load the current snapshot, call the merge helper,
always save the merged snapshot, then navigate. Remove the current
`if (!existingTicket)` gate.

- [ ] **Step 3: Verify RED**

```bash
node --test tests/saleTicket.test.ts tests/saleTicketWiring.test.mjs
```

Expected: helper and always-save wiring missing.

- [ ] **Step 4: Implement the pure merge and screen flow**

Implement:

```typescript
export function mergeSaleTicketFromOrder(
  current: SaleTicketSnapshot | null,
  order: SaleTicketOrderSource,
): SaleTicketSnapshot {
  const authoritative = buildSaleTicketSnapshotFromOrder(order);
  if (!current) return authoritative;
  const employeeName = order.employee_name?.trim();
  return {
    ...current,
    odooFolio: authoritative.odooFolio ?? current.odooFolio,
    sellerName: employeeName || current.sellerName,
  };
}
```

In `openTicketForOrder`, save and navigate using the merged ticket's `saleId`.

- [ ] **Step 5: Verify GREEN**

Run the Step 3 command and `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add \
  app/(tabs)/sales.tsx \
  src/services/saleTicket.ts \
  tests/saleTicket.test.ts \
  tests/saleTicketWiring.test.mjs
git commit -m "fix: refresh ticket folio and seller"
```

### Task 6: Align preview and PDF output

**Files:**
- Modify: `tests/saleTicket.test.ts`
- Modify: `tests/thermalTicketDocument.test.ts`
- Modify: `tests/thermalPrinterService.test.ts`
- Modify: `tests/thermalPrinterUiWiring.test.mjs`
- Modify: `src/services/saleTicket.ts`
- Modify: `src/services/thermalTicketDocument.ts`
- Modify: `src/services/thermalPrinterTypes.ts`
- Modify: `src/services/thermalPrinter.ts`
- Modify: `app/print/[orderId].tsx`

- [ ] **Step 1: Write failing PDF tests for both states**

Official:

```typescript
assert.match(html, /Folio Odoo/);
assert.match(html, /S00042/);
assert.doesNotMatch(html, /Referencia local/);
```

Pending:

```typescript
assert.match(html, /Folio Odoo/);
assert.match(html, /Pendiente por sincronizar/);
assert.match(html, /Referencia local/);
assert.match(html, /mobile-op-1/);
```

- [ ] **Step 2: Write failing thermal-document tests**

Require official output:

```typescript
assert.equal(document.folio, 'S00042');
assert.equal(document.localReference, undefined);
```

Require pending output:

```typescript
assert.equal(document.folio, 'Pendiente por sincronizar');
assert.equal(document.localReference, 'mobile-op-1');
```

- [ ] **Step 3: Write failing native-service boundary tests**

Require `printThermalTicket()` to preserve a valid optional
`localReference: 'mobile-op-1'` in the immutable document passed to the native
module. Add invalid-type coverage and retain the existing defensive validation
for every required ticket field.

- [ ] **Step 4: Write failing preview wiring assertions**

Require the screen to use `getSaleTicketFolioPresentation(ticket)`, render
`Folio Odoo`, conditionally render `Referencia local`, remove `#{ticket.saleId}`,
and keep both output buttons enabled according only to their existing busy
states.

- [ ] **Step 5: Verify RED**

```bash
node --test \
  tests/saleTicket.test.ts \
  tests/thermalTicketDocument.test.ts \
  tests/thermalPrinterService.test.ts \
  tests/thermalPrinterUiWiring.test.mjs
```

Expected: all new presentation assertions fail.

- [ ] **Step 6: Implement shared PDF and thermal presentation**

Use `getSaleTicketFolioPresentation` once in each builder. In HTML emit:

```html
<div class="row"><span>Folio Odoo</span><span>...</span></div>
```

and only when pending:

```html
<div class="row"><span>Referencia local</span><span>...</span></div>
```

Add `localReference?: string` to `ThermalTicketDocument` and populate it only
when the shared presentation returns a local reference. Update
`thermalPrinter.ts` so its validation/snapshot boundary accepts only a
non-empty optional string and includes that value in the object passed to the
native module.

- [ ] **Step 7: Update the preview**

Compute the presentation from `ticket`. Render the same two labels and values.
Do not add a connectivity gate or a missing-folio gate to the MP210/PDF buttons.

- [ ] **Step 8: Verify GREEN**

Run the Step 4 command and `npm run typecheck`.

- [ ] **Step 9: Commit**

```bash
git add \
  app/print/[orderId].tsx \
  src/services/saleTicket.ts \
  src/services/thermalTicketDocument.ts \
  src/services/thermalPrinterTypes.ts \
  src/services/thermalPrinter.ts \
  tests/saleTicket.test.ts \
  tests/thermalTicketDocument.test.ts \
  tests/thermalPrinterService.test.ts \
  tests/thermalPrinterUiWiring.test.mjs
git commit -m "feat: show pending and Odoo ticket folios"
```

### Task 7: Extend the native MP210 contract and layout

**Files:**
- Modify: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalPrinterModuleTest.kt`
- Modify: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketLayoutTest.kt`
- Modify: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterRecords.kt`
- Modify: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt`

- [ ] **Step 1: Add failing record-boundary tests**

Extend the valid record fixture with optional `localReference`. Prove:

- `null` is accepted and stays null;
- `mobile-op-1` is normalized and preserved;
- blank becomes null;
- overlong and unsafe isolated-surrogate values fail as `invalid_ticket`;
- aggregate display budget includes the optional field.

- [ ] **Step 2: Add failing layout tests**

Official ticket:

```kotlin
val official = subject.layout(ticket(folio = "S00042", localReference = null))
assertTrue(official.hasText("Folio Odoo:"))
assertTrue(official.hasText("S00042"))
assertFalse(official.hasText("Referencia local:"))
```

Pending ticket:

```kotlin
val pending = subject.layout(
  ticket(
    folio = "Pendiente por sincronizar",
    localReference = "mobile-op-1",
  ),
)
assertTrue(pending.hasText("Folio Odoo:"))
assertTrue(pending.hasText("Pendiente por sincronizar"))
assertTrue(pending.hasText("Referencia local:"))
assertTrue(pending.hasText("mobile-op-1"))
```

Update the local `ticket()` fixture to accept `folio` and `localReference`
arguments.

- [ ] **Step 3: Generate the Android project from tracked state**

```bash
npx expo prebuild --platform android --clean --no-install
node scripts/verify-thermal-printer-android.mjs
```

Expected: generation succeeds and the local Expo module is present in the
generated project.

- [ ] **Step 4: Verify RED**

From `android/`, run:

```bash
./gradlew :thermal-printer:testDebugUnitTest \
  --tests mx.grupofrio.thermalprinter.ThermalPrinterModuleTest \
  --tests mx.grupofrio.thermalprinter.ThermalTicketLayoutTest
```

Expected: compile/test failure because `localReference` is absent.

- [ ] **Step 5: Implement the optional native field**

Add `@Field var localReference: String? = null` to
`ThermalTicketDocumentRecord` and `val localReference: String? = null` to
`ThermalTicket`.

At both record preflight and domain validation:

```kotlin
budget.optional(localReference, "localReference", MAX_SHORT_TEXT_CHARS)
```

Normalize with:

```kotlin
localReference = optionalDisplayText(
  localReference,
  "localReference",
  MAX_SHORT_TEXT_CHARS,
)
```

- [ ] **Step 6: Implement the layout labels**

Replace:

```kotlin
builder.addLabelValue("Folio:", safeTicket.folio, BODY_STYLE)
```

with:

```kotlin
builder.addLabelValue("Folio Odoo:", safeTicket.folio, BODY_STYLE)
safeTicket.localReference?.let {
  builder.addLabelValue("Referencia local:", it, BODY_STYLE)
}
```

- [ ] **Step 7: Verify GREEN**

Run the targeted Gradle command from Step 3.

Expected: all selected Kotlin tests pass.

- [ ] **Step 8: Commit**

```bash
git add \
  modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterRecords.kt \
  modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt \
  modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalPrinterModuleTest.kt \
  modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketLayoutTest.kt
git commit -m "feat: print local reference while folio syncs"
```

### Task 8: Full verification, review, and publication

**Files:**
- Review all files changed by Tasks 1-7.
- Update: `docs/MP210_BLUETOOTH_PRINT_QA.md` only with evidence actually rerun.

- [ ] **Step 1: Run all JavaScript and TypeScript checks**

```bash
npm test
npm run typecheck
git diff --check
```

Expected: all tests pass, typecheck exits 0, no whitespace errors.

- [ ] **Step 2: Recreate Android from tracked state**

```bash
npx expo prebuild --platform android --clean --no-install
node scripts/verify-thermal-printer-android.mjs
```

Expected: clean Prebuild succeeds and permissions/autolinking verification
passes.

- [ ] **Step 3: Run native tests and release build**

From `android/`:

```bash
./gradlew \
  :thermal-printer:testDebugUnitTest \
  :app:assembleRelease
```

Expected: `BUILD SUCCESSFUL`, zero Kotlin test failures.

- [ ] **Step 4: Install and smoke-test both ticket states**

Install the fresh APK on the authorized Android device. Verify:

1. an offline/pending ticket prints `Folio Odoo: Pendiente por sincronizar` and
   `Referencia local: <operationId>`;
2. after synchronization and reopening, the same ticket prints the Odoo name
   and hides the local reference;
3. a ticket opened from Ventas shows the seller returned by Odoo;
4. PDF, preview, and MP210 agree;
5. print buttons are available in both folio states.

- [ ] **Step 5: Update QA evidence**

Record the exact commands, counts, APK hash, device, and physical results. Do
not claim a paper result that was not visually confirmed.

- [ ] **Step 6: Request code review**

Use `superpowers:requesting-code-review`. Resolve every P0/P1 finding and rerun
the affected tests plus the full JavaScript suite.

- [ ] **Step 7: Commit QA evidence**

```bash
git add docs/MP210_BLUETOOTH_PRINT_QA.md
git commit -m "docs: verify Odoo ticket folio printing"
```

- [ ] **Step 8: Publish after backend compatibility is confirmed**

```bash
git push -u origin codex/odoo-ticket-folio
```

Merge to `main` only after the backend branch is deployed or its additive field
is confirmed available. Verify `origin/main` resolves to the merged commit.
