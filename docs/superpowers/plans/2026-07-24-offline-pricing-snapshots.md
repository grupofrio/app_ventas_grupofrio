# Offline Customer Pricing Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache complete Odoo-calculated prices per customer and resolved pricelist during route preparation so offline carts and tickets use the correct customer price.

**Architecture:** Add a pure, versioned pricing-snapshot state machine and a small persistence repository. Route preparation is the only writer allowed to activate a `prepared_customer` manifest; foreground online pricing may update only the same-list last-known ledger. `ProductPicker` resolves from this state before falling back to public price, and the captured unit price remains immutable through cart, ticket, persistence, and printing.

**Tech Stack:** TypeScript, React Native/Expo, Zustand, AsyncStorage through `src/persistence/storage.ts`, Node 22 test runner.

**Design spec:** `docs/superpowers/specs/2026-07-23-offline-pricing-snapshot-design.md`

**Delivery order:** Implement this plan before pending-sales projection and offline-catalog continuity.

---

## File map

- Create `src/services/customerPricingSnapshot.ts`: pure snapshot types, validation, atomic activation, canonicalization, and per-product resolution.
- Create `src/services/customerPricingSnapshotRepository.ts`: load/save the single versioned AsyncStorage document and discard incompatible data.
- Modify `src/persistence/storage.ts`: add the new durable storage key.
- Modify `src/services/pricelist.ts`: expose a full server-calculated price response without filtering prices equal to `list_price`.
- Modify `src/stores/useRoutePreparationStore.ts`: prepare unique customer/list targets and atomically activate one run.
- Modify `src/components/domain/ProductPicker.tsx`: resolve prices from snapshots and require confirmation for public fallback.
- Modify `src/stores/useVisitStore.ts`: add optional captured-price metadata to `SaleLineItem`.
- Modify `src/services/saleTicket.ts`: carry optional pricing metadata without changing printed totals.
- Modify `src/services/saleTicketStorage.ts`: allow a synchronized Odoo ticket to replace the local ticket for reprint.
- Modify `app/(tabs)/sales.tsx`: replace the local ticket snapshot after a remote order is available.
- Modify `src/services/rehydrate.ts`: load the pricing snapshot repository before screens consume it.
- Test with focused new unit tests plus existing pricing, ticket, offline-sale, typecheck, and full suite.

### Task 1: Pure snapshot model and validation

**Files:**
- Create: `src/services/customerPricingSnapshot.ts`
- Create: `tests/customerPricingSnapshot.test.ts`

- [ ] **Step 1: Write failing validation and activation tests**

Cover:

```ts
test('rejects a response without exact requested product coverage', () => {
  const result = validateServerPriceSnapshot({
    resolvedPricelistId: 81,
    requestedProductIds: [10, 20],
    rows: [{ productId: 10, unitPrice: 42 }],
  });
  assert.equal(result.ok, false);
});

test('activates a run without overwriting snapshots referenced by the prior manifest', () => {
  const next = activatePreparedPricingRun(previous, runInput);
  assert.equal(next.activeManifest?.preparationRunId, 'run-new');
  assert.ok(next.snapshots['run-old:34:99:81']);
  assert.ok(next.snapshots['run-new:34:99:81']);
});
```

Also test negative/non-finite prices, extra response rows, duplicated requested IDs, and a failed target that leaves the prior ledger intact.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --experimental-strip-types tests/customerPricingSnapshot.test.ts
```

Expected: FAIL because `customerPricingSnapshot.ts` does not exist.

- [ ] **Step 3: Implement the versioned pure state**

Define:

```ts
export interface PricingSnapshotStateV1 {
  version: 1;
  activeManifest: PricingPreparationManifest | null;
  snapshots: Record<string, PreparedCustomerPricingSnapshot>;
  requestedMappings: Record<string, ResolvedPricelistMapping>;
  lastKnownPrices: Record<string, Record<string, LastKnownCustomerProductPrice>>;
}

export function emptyPricingSnapshotState(): PricingSnapshotStateV1;
export function validateServerPriceSnapshot(input: ValidateServerPriceSnapshotInput): ValidationResult;
export function activatePreparedPricingRun(
  current: PricingSnapshotStateV1,
  input: ActivatePreparedPricingRunInput,
): PricingSnapshotStateV1;
export function recordLastKnownServerPrices(
  current: PricingSnapshotStateV1,
  input: RecordLastKnownServerPricesInput,
): PricingSnapshotStateV1;
```

Use immutable run-scoped `snapshotId` values. Requested list IDs live only in mappings/manifests; snapshot identity uses the positive resolved list ID.

- [ ] **Step 4: Add canonical resolution tests**

Cover:

```ts
test('canonicalizes requested list before prepared lookup', () => {
  const result = resolveCapturedCustomerPrice(state, {
    companyId: 34,
    planId: 7,
    partnerId: 99,
    requestedPricelistId: 104,
    productId: 10,
    publicPrice: 100,
  });
  assert.deepEqual(result, {
    unitPrice: 42,
    source: 'prepared_customer',
    capturedAtMs: 1_000,
    pricelistId: 81,
  });
});
```

Test prepared → ledger → public order, null requested list without mapping, two requested lists sharing one canonical snapshot, and an older requested-key snapshot that must not win.

- [ ] **Step 5: Implement `resolveCapturedCustomerPrice` minimally**

Return:

```ts
export interface CapturedCustomerPrice {
  unitPrice: number;
  source: 'prepared_customer' | 'last_known_customer' | 'public_fallback';
  capturedAtMs: number | null;
  pricelistId: number | null;
}
```

Canonicalize first. Use the active manifest only when plan, target, snapshot ID, partner, and canonical list agree. Otherwise query the same-list ledger. Never use another list from the same customer.

- [ ] **Step 6: Run focused tests**

Run the same command.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/customerPricingSnapshot.ts tests/customerPricingSnapshot.test.ts
git commit -m "feat: model customer pricing snapshots"
```

### Task 2: Durable repository and migration boundary

**Files:**
- Create: `src/services/customerPricingSnapshotRepository.ts`
- Create: `tests/customerPricingSnapshotRepository.test.ts`
- Modify: `src/persistence/storage.ts`
- Modify: `src/services/rehydrate.ts`
- Test: `tests/priceCachePersistence.test.ts`
- Test: `tests/productCachePersistent.test.mjs`

- [ ] **Step 1: Add the new storage key**

Add:

```ts
CUSTOMER_PRICING_SNAPSHOTS: 'cache:customerPricingSnapshots:v1',
```

Do not reuse `PRICES_CACHE`; it is the incomplete legacy override cache.

- [ ] **Step 2: Write failing repository tests with an in-memory adapter**

The repository constructor accepts:

```ts
interface PricingSnapshotStorage {
  load(): Promise<unknown>;
  saveStrict(state: PricingSnapshotStateV1): Promise<void>;
}
```

Test valid round-trip, corrupt/version-mismatched input returning an empty state, serialized writes, and a failed strict save leaving the in-memory published state unchanged.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test --experimental-strip-types tests/customerPricingSnapshotRepository.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 4: Implement the repository**

Expose:

```ts
export async function hydrateCustomerPricingSnapshots(): Promise<PricingSnapshotStateV1>;
export function getCustomerPricingSnapshotState(): PricingSnapshotStateV1;
export async function replaceCustomerPricingSnapshotState(
  next: PricingSnapshotStateV1,
): Promise<void>;
export async function updateCustomerPricingSnapshotState(
  updater: (current: PricingSnapshotStateV1) => PricingSnapshotStateV1,
): Promise<PricingSnapshotStateV1>;
```

Serialize updates so concurrent route preparation and foreground price refreshes cannot lose writes. Publish the new in-memory state only after `storeSaveStrict` succeeds.

- [ ] **Step 5: Wire boot rehydration**

In `src/services/rehydrate.ts`, hydrate the new repository before catalog/price consumers. Keep legacy `hydratePriceCacheFromDisk()` for compatibility, but do not promote its output.

- [ ] **Step 6: Run focused and legacy persistence tests**

```bash
node --test --experimental-strip-types \
  tests/customerPricingSnapshotRepository.test.ts \
  tests/priceCachePersistence.test.ts \
  tests/productCachePersistent.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/persistence/storage.ts src/services/customerPricingSnapshotRepository.ts src/services/rehydrate.ts tests/customerPricingSnapshotRepository.test.ts tests/priceCachePersistence.test.ts tests/productCachePersistent.test.mjs
git commit -m "feat: persist customer pricing snapshots"
```

### Task 3: Full server pricing contract

**Files:**
- Modify: `src/services/pricelist.ts`
- Create: `tests/serverCustomerPricingSnapshot.test.ts`
- Modify: `tests/pricelistWarmup.test.ts`

- [ ] **Step 1: Write failing tests for a full server result**

Introduce an injected request boundary so the pure parser can be tested:

```ts
const result = parseServerCustomerPricingSnapshot({
  data: {
    partner_id: 99,
    pricelist_id: 81,
    prices: [
      { product_id: 10, price_unit: 100 },
      { product_id: 20, price_unit: 42 },
    ],
  },
}, [10, 20]);

assert.deepEqual([...result.prices], [[10, 100], [20, 42]]);
```

Test that prices equal to public price are retained, resolved list is required, missing/invalid requested IDs fail validation, extra server rows are discarded, and the existing display cache may still store only overrides.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --test --experimental-strip-types tests/serverCustomerPricingSnapshot.test.ts
```

Expected: FAIL for missing parser/export.

- [ ] **Step 3: Implement the server snapshot API**

Add:

```ts
export async function fetchServerCustomerPricingSnapshot(
  partnerId: number,
  products: PricingProduct[],
  options?: PricingOptions,
): Promise<ValidatedServerPriceSnapshot>;
```

It calls `pricing/by_partner`, preserves `data.pricelist_id`, parses all requested rows, discards extras, and passes the result through `validateServerPriceSnapshot`. Do not silently fall back to client-side pricelist rules in this API.

Keep `computeCustomerPrices` behavior compatible by deriving its override map from the full result when available.

- [ ] **Step 4: Run pricing tests**

```bash
node --test --experimental-strip-types \
  tests/serverCustomerPricingSnapshot.test.ts \
  tests/pricelistWarmup.test.ts \
  tests/pricelistCacheStability.test.ts \
  tests/salePricelistDecision.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/pricelist.ts tests/serverCustomerPricingSnapshot.test.ts tests/pricelistWarmup.test.ts
git commit -m "feat: expose complete Odoo customer prices"
```

### Task 4: Atomic route preparation by customer and requested list

**Files:**
- Modify: `src/stores/useRoutePreparationStore.ts`
- Create: `src/services/routePricingTargets.ts`
- Modify: `src/services/routePreparationLogic.ts`
- Create: `tests/routePricingTargets.test.ts`
- Create: `tests/routePricingPreparation.test.ts`
- Modify: `src/components/domain/RoutePreparationCard.tsx`

- [ ] **Step 1: Write failing target-deduplication tests**

Test:

```ts
assert.deepEqual(buildRoutePricingTargets(stops), [
  { partnerId: 99, requestedPricelistId: 81 },
  { partnerId: 99, requestedPricelistId: 90 },
]);
```

Cover duplicate stops, null list IDs, invalid partners, and same partner with different lists.

- [ ] **Step 2: Run target test and verify RED**

```bash
node --test --experimental-strip-types tests/routePricingTargets.test.ts
```

- [ ] **Step 3: Implement `routePricingTargets.ts`**

Keep it pure and independent of Zustand.

- [ ] **Step 4: Write failing preparation-run tests**

Extract a state-independent fetch orchestrator that receives `fetchTarget`, plan ID, company ID, and run ID and returns settled candidates/target results without capturing repository state. Verify:

- all targets settle independently;
- successful targets create candidates;
- failed targets are recorded in the manifest;
- one final repository updater activates the run;
- a thrown save does not publish partial state.

Add a race test:

1. preparation starts fetching;
2. a foreground response updates the last-known ledger;
3. preparation fetches settle;
4. `updateCustomerPricingSnapshotState(current => activatePreparedPricingRun(current, run))` runs;
5. both the foreground ledger update and active manifest remain.

- [ ] **Step 5: Implement route preparation integration**

Replace partner-only `dedupePartnerIds(stops)` for pricing with `buildRoutePricingTargets(stops)`. Keep bounded concurrency at four. Call `fetchServerCustomerPricingSnapshot` for each target. After all workers finish, call:

```ts
await updateCustomerPricingSnapshotState((current) =>
  activatePreparedPricingRun(current, settledRun),
);
```

Never pass a pre-fetch state snapshot into the asynchronous orchestrator.

Update preparation counts/copy to refer to customer/list combinations.

- [ ] **Step 6: Replace the partner-only retry path**

Extend `PreparationFailure` with `requestedPricelistId`. `retryFailures` must retry the exact `{ partnerId, requestedPricelistId }` targets through `fetchServerCustomerPricingSnapshot`, never `computeCustomerPrices`.

After retries settle, activate and persist one replacement manifest through `updateCustomerPricingSnapshotState(current => ...)`:

- reuse the prior manifest's `snapshotId` for targets that were already prepared;
- attach new run-scoped snapshot IDs for recovered targets;
- retain `failed` for targets that still fail;
- never publish one target at a time.

Add tests that a failed list 90 for a customer with successful list 81 retries only list 90 and cannot overwrite list 81.

- [ ] **Step 7: Run focused route preparation tests**

```bash
node --test --experimental-strip-types \
  tests/routePricingTargets.test.ts \
  tests/routePricingPreparation.test.ts \
  tests/pricelistWarmup.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/routePricingTargets.ts src/services/routePreparationLogic.ts src/stores/useRoutePreparationStore.ts src/components/domain/RoutePreparationCard.tsx tests/routePricingTargets.test.ts tests/routePricingPreparation.test.ts
git commit -m "feat: prepare prices per customer pricelist"
```

### Task 5: Offline picker resolution and explicit public fallback

**Files:**
- Modify: `src/components/domain/ProductPicker.tsx`
- Modify: `src/stores/useVisitStore.ts`
- Create: `src/services/productPriceSelection.ts`
- Create: `tests/productPriceSelection.test.ts`
- Modify: `tests/offlineSaleWiring.test.mjs`

- [ ] **Step 1: Write failing selection tests**

Create a pure decision:

```ts
const decision = selectProductPrice({
  isOnline: false,
  snapshotPrice: { unitPrice: 42, source: 'prepared_customer', capturedAtMs: 1_000, pricelistId: 81 },
  publicPrice: 100,
});
assert.equal(decision.requiresPublicFallbackConfirmation, false);
assert.equal(decision.price.unitPrice, 42);
```

Test last-known and public fallback warning.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --test --experimental-strip-types tests/productPriceSelection.test.ts
```

- [ ] **Step 3: Implement the pure selection helper**

Do not put alert or React code in the service.

- [ ] **Step 4: Extend `SaleLineItem` compatibly**

Add optional fields:

```ts
priceSource?: 'prepared_customer' | 'last_known_customer' | 'public_fallback';
priceCapturedAtMs?: number | null;
pricelistId?: number | null;
```

Existing persisted visit snapshots remain valid.

- [ ] **Step 5: Integrate `ProductPicker`**

When offline, call `resolveCapturedCustomerPrice` for every product. On public fallback, show one `Alert.alert` confirmation before `onAddLine`/`addSaleLine`; cancellation leaves the picker open. Build the line with the chosen price and metadata.

When a complete online foreground response arrives, call `recordLastKnownServerPrices` through the repository; never activate a prepared manifest.

- [ ] **Step 6: Run focused and wiring tests**

```bash
node --test --experimental-strip-types \
  tests/productPriceSelection.test.ts \
  tests/offlineSaleWiring.test.mjs \
  tests/salePricing.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/domain/ProductPicker.tsx src/stores/useVisitStore.ts src/services/productPriceSelection.ts tests/productPriceSelection.test.ts tests/offlineSaleWiring.test.mjs
git commit -m "feat: use captured customer prices offline"
```

### Task 6: Ticket metadata and authoritative remote reprint

**Files:**
- Modify: `src/services/saleTicket.ts`
- Modify: `src/services/saleTicketStorage.ts`
- Modify: `src/services/saleRecoveryIntent.ts`
- Modify: `app/(tabs)/sales.tsx`
- Modify: `tests/saleTicket.test.ts`
- Modify: `tests/saleRecoveryIntent.test.ts`
- Modify: `tests/saleTicketWiring.test.mjs`
- Create: `tests/saleTicketReplacement.test.ts`

- [ ] **Step 1: Write failing ticket compatibility tests**

Verify local ticket lines preserve optional price source, capture time, and list ID, while HTML totals remain unchanged. Verify a legacy snapshot without fields loads normally.

- [ ] **Step 2: Write failing replacement-policy tests**

Add a pure decision:

```ts
assert.equal(shouldReplaceTicketSnapshot({
  existingOrigin: 'local',
  incomingOrigin: 'odoo',
}), true);
```

Odoo may replace local; local must not replace Odoo.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test --experimental-strip-types \
  tests/saleTicket.test.ts \
  tests/saleTicketReplacement.test.ts
```

- [ ] **Step 4: Implement ticket metadata and replacement**

Add `origin?: 'local' | 'odoo'` to snapshots with legacy default `local`. Add `saveAuthoritativeSaleTicketSnapshot` that replaces `sale-ticket:<operationId>` only with a snapshot built from `GFSalesOrder`.

- [ ] **Step 5: Preserve metadata through crash recovery**

Update `restoreTicketSnapshot` in `src/services/saleRecoveryIntent.ts` to copy and validate optional snapshot `origin` plus optional per-line `priceSource`, `priceCapturedAtMs`, and `pricelistId`. Missing fields remain valid for legacy recovery; invalid present values reject the intent.

Extend `tests/saleRecoveryIntent.test.ts` with a JSON round-trip proving the fields survive rehydration.

- [ ] **Step 6: Wire remote order opening**

In `app/(tabs)/sales.tsx`, build the Odoo snapshot and save it authoritatively before navigating to `/print/<operationId>`. Do not update customer-pricing snapshots from this path.

- [ ] **Step 7: Run ticket, recovery, and sales wiring tests**

```bash
node --test --experimental-strip-types \
  tests/saleTicket.test.ts \
  tests/saleRecoveryIntent.test.ts \
  tests/saleTicketReplacement.test.ts \
  tests/saleTicketWiring.test.mjs \
  tests/salesListLinesWiring.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/saleTicket.ts src/services/saleTicketStorage.ts src/services/saleRecoveryIntent.ts 'app/(tabs)/sales.tsx' tests/saleTicket.test.ts tests/saleRecoveryIntent.test.ts tests/saleTicketReplacement.test.ts tests/saleTicketWiring.test.mjs
git commit -m "feat: preserve offline price provenance in tickets"
```

### Task 7: Full verification

**Files:**
- Modify only if verification exposes a regression.

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 2: Run the complete test suite**

```bash
npm test
```

Expected: all test files pass.

- [ ] **Step 3: Run lint-equivalent repository checks**

This repository has no lint script. Use:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Perform manual device scenario**

1. Online, prepare a route containing a customer with a non-public pricelist.
2. Confirm the preparation card reports that customer/list as ready.
3. Enable airplane mode and restart the app.
4. Add a product and verify the displayed price matches the prepared Odoo price.
5. Confirm the sale and print; verify cart and ticket unit price/total match.
6. Reconnect, let the sale sync, open it from Sales, and verify the reprint uses Odoo lines.
7. Repeat with a customer lacking any snapshot; verify the public-price warning appears.

- [ ] **Step 5: Commit any verification-only fixes**

```bash
git add <exact-files-fixed>
git commit -m "fix: close offline pricing verification gaps"
```

Skip this commit if no files changed.
