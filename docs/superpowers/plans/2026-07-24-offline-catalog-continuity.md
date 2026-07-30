# Offline Catalog Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let visit-sale users select known products and any positive quantity offline from the last connected catalog or recent local sales, while keeping strict online stock checks and durable attention state for Odoo stock rejection.

**Architecture:** Keep the existing short-lived catalog cache, add a separately keyed last-known catalog and a bounded recent-product index, then build a pure effective catalog with explicit inventory freshness. The offline bypass is an opt-in `ProductPicker` policy used only by visit sales. Sync persists `insufficient_stock` as a protected terminal business error that survives restart and generic dead-item cleanup and continues blocking close/cut until explicit retry succeeds.

**Tech Stack:** TypeScript, React Native/Expo, Zustand, AsyncStorage persistence, existing Odoo sync queue, Node 22 test runner.

**Design spec:** `docs/superpowers/specs/2026-07-23-offline-catalog-continuity-design.md`

**Dependencies:** Implement after the pricing-snapshot and pending-sales plans because recovered products use the snapshot resolver and protected errors must appear in the unified Sales list.

---

## File map

- Create `src/services/effectiveOfflineCatalog.ts`: pure catalog union, source/freshness model, and selection rules.
- Create `src/services/recentProductIndex.ts`: pure 100-entry deterministic LRU.
- Create `src/services/offlineCatalogRepository.ts`: durable last-known catalog and recent-product persistence.
- Modify `src/persistence/storage.ts`: add versioned last-known catalog/recent-product keys.
- Modify `src/stores/useProductStore.ts`: persist successful loads, rehydrate last known, expose freshness/recent products, and refresh authority.
- Modify `src/services/rehydrate.ts`: load last-known catalog/recent index without day expiry.
- Modify `src/components/domain/ProductPicker.tsx`: add opt-in stock policy and effective catalog rendering.
- Modify `app/sale/[stopId].tsx`: opt into offline sale policy, skip only offline stock limits, record recent products.
- Modify `src/types/sync.ts`, `src/stores/useSyncStore.ts`, `src/services/saleRetry.ts`, and `app/sync.tsx`: persist/protect/retry `insufficient_stock`.
- Modify pending-sales status projection only to consume the durable code; do not duplicate queue state.
- Add focused tests and run the full suite.

### Task 1: Effective catalog and deterministic recent-product index

**Files:**
- Create: `src/services/effectiveOfflineCatalog.ts`
- Create: `src/services/recentProductIndex.ts`
- Create: `tests/effectiveOfflineCatalog.test.ts`
- Create: `tests/recentProductIndex.test.ts`

- [ ] **Step 1: Write failing catalog-union tests**

Cover current > last-known > recent precedence:

```ts
const result = buildEffectiveOfflineCatalog({
  currentProducts: [currentProduct(10)],
  lastKnownProducts: [cachedProduct(10), cachedProduct(20)],
  recentProducts: [recentProduct(20), recentProduct(30)],
});

assert.deepEqual(result.map((p) => [p.productId, p.origin]), [
  [10, 'current'],
  [20, 'last_known'],
  [30, 'recent'],
]);
```

Test `inventoryFreshness`:

- current authoritative → `authoritative`;
- last known/current cache → `cached`;
- recent only → `unknown`.

- [ ] **Step 2: Write failing LRU tests**

Test upsert, duplicate refresh, context isolation, limit 100, and equal-time eviction ordered by `productId` ascending.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test --experimental-strip-types \
  tests/effectiveOfflineCatalog.test.ts \
  tests/recentProductIndex.test.ts
```

Expected: FAIL because the services do not exist.

- [ ] **Step 4: Implement focused pure types**

Define:

```ts
export type InventoryFreshness = 'authoritative' | 'cached' | 'unknown';
export type EffectiveProductOrigin = 'current' | 'last_known' | 'recent';

export interface EffectiveOfflineProduct {
  productId: number;
  name: string;
  defaultCode: string | null;
  listPrice: number;
  weight: number;
  qtyDisplay: number | null;
  origin: EffectiveProductOrigin;
  inventoryFreshness: InventoryFreshness;
  inventoryCapturedAtMs: number | null;
}
```

Do not fabricate `TruckProduct` values for missing inventory.

- [ ] **Step 5: Implement 100-entry LRU**

`upsertRecentProducts` sorts eviction candidates by `lastSeenAtMs`, then `productId`. Keep the newest 100 per exact context.

- [ ] **Step 6: Run focused tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/effectiveOfflineCatalog.ts src/services/recentProductIndex.ts tests/effectiveOfflineCatalog.test.ts tests/recentProductIndex.test.ts
git commit -m "feat: model effective offline catalog"
```

### Task 2: Last-known catalog and recent-index persistence

**Files:**
- Create: `src/services/offlineCatalogRepository.ts`
- Create: `tests/offlineCatalogRepository.test.ts`
- Modify: `src/persistence/storage.ts`

- [ ] **Step 1: Add versioned keys**

Add:

```ts
LAST_KNOWN_CATALOG: 'cache:products:lastKnown:v1',
RECENT_PRODUCTS: 'cache:products:recent:v1',
```

Keep `PRODUCTS_CATALOG` for same-day/freshness behavior.

- [ ] **Step 2: Write failing repository tests**

Use an injected storage adapter. Test:

- context key includes employee, company, warehouse, mobile location but not day;
- a next-day read succeeds;
- different context returns no data;
- corrupt/version-mismatched values are ignored;
- failed new save does not delete the prior snapshot;
- recent index persists exactly 100.

- [ ] **Step 3: Run repository test and verify RED**

```bash
node --test --experimental-strip-types tests/offlineCatalogRepository.test.ts
```

- [ ] **Step 4: Implement repository**

Expose:

```ts
export function buildOfflineCatalogContext(auth: AuthSnapshot): OfflineCatalogContext;
export async function loadLastKnownCatalog(context: OfflineCatalogContext): Promise<LastKnownCatalogSnapshot | null>;
export async function saveLastKnownCatalogStrict(snapshot: LastKnownCatalogSnapshot): Promise<void>;
export async function loadRecentProducts(context: OfflineCatalogContext): Promise<RecentProductSnapshot[]>;
export async function saveRecentProductsStrict(context: OfflineCatalogContext, products: RecentProductSnapshot[]): Promise<void>;
```

Use strict saves when replacing valid prior data.

- [ ] **Step 5: Run focused tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/persistence/storage.ts src/services/offlineCatalogRepository.ts tests/offlineCatalogRepository.test.ts
git commit -m "feat: persist last-known sale catalog"
```

### Task 3: Product store rehydration and authority state

**Files:**
- Modify: `src/stores/useProductStore.ts`
- Modify: `src/services/rehydrate.ts`
- Modify: `tests/productCachePersistent.test.mjs`
- Create: `tests/productInventoryFreshness.test.ts`
- Create: `tests/productStoreOfflineCatalogWiring.test.mjs`

- [ ] **Step 1: Write failing freshness tests**

Create pure helpers for:

```ts
describeInventoryAuthority({
  isOnline: true,
  loadedWarehouseId: 8,
  expectedWarehouseId: 8,
  inventorySource: 'truck_stock',
  fromCache: false,
}) === 'authoritative';
```

Cached/unknown results must not become authoritative merely because NetInfo says online.

- [ ] **Step 2: Update persistence wiring test first**

Require:

- successful `loadProducts` saves same-day and last-known snapshots;
- a failed refresh never removes last-known;
- `hydrateFromCache` tries same-day first, then last-known;
- next-day last-known rehydrates as `cached`;
- `rehydrate.ts` loads recent products.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test --experimental-strip-types \
  tests/productInventoryFreshness.test.ts \
  tests/productCachePersistent.test.mjs \
  tests/productStoreOfflineCatalogWiring.test.mjs
```

- [ ] **Step 4: Extend `ProductState`**

Add:

```ts
inventoryFreshness: InventoryFreshness;
recentProducts: RecentProductSnapshot[];
hydrateOfflineCatalog: (warehouseId: number | null) => Promise<number>;
recordRecentProducts: (lines: SaleLineItem[]) => Promise<void>;
```

Keep legacy fields while callers migrate.

- [ ] **Step 5: Persist successful online loads**

After a valid product list is normalized, write both `PRODUCTS_CATALOG` and `LAST_KNOWN_CATALOG`. Never write an empty/failed response over last-known.

- [ ] **Step 6: Rehydrate with fallback**

At boot:

1. try current same-day cache;
2. if unavailable, load last-known exact context;
3. load recent products;
4. expose `cached`/`unknown` freshness.

- [ ] **Step 7: Run focused tests**

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/stores/useProductStore.ts src/services/rehydrate.ts tests/productInventoryFreshness.test.ts tests/productCachePersistent.test.mjs tests/productStoreOfflineCatalogWiring.test.mjs
git commit -m "feat: rehydrate last-known sale products"
```

### Task 4: Opt-in offline stock policy in ProductPicker

**Files:**
- Modify: `src/components/domain/ProductPicker.tsx`
- Modify: `src/stores/useVisitStore.ts`
- Modify: `app/sale/[stopId].tsx`
- Create: `src/services/productStockPolicy.ts`
- Create: `tests/productStockPolicy.test.ts`
- Create: `tests/productPickerStockPolicyWiring.test.mjs`

- [ ] **Step 1: Write failing policy tests**

Define:

```ts
type ProductStockPolicy = 'strict' | 'offline_sale';
```

Test:

```ts
assert.equal(canSelectProduct({
  policy: 'offline_sale',
  isOnline: false,
  qtyDisplay: 0,
  freshness: 'cached',
}), true);

assert.equal(canSelectProduct({
  policy: 'strict',
  isOnline: false,
  qtyDisplay: 0,
  freshness: 'cached',
}), false);
```

Also test any positive quantity offline and strict online caps.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --test --experimental-strip-types tests/productStockPolicy.test.ts
```

- [ ] **Step 3: Implement pure policy**

Export selection, quantity cap, label, and authority-refresh decisions. Offline sale never accepts zero/negative/NaN quantity.

- [ ] **Step 4: Add optional prop with strict default**

```ts
stockPolicy?: ProductStockPolicy;
```

Build the displayed products with `buildEffectiveOfflineCatalog`. Under offline sale:

- do not filter zero/unknown stock;
- do not return early in `handleSelect`;
- do not use stale stock as quantity maximum;
- show `Stock sin validar` and capture time.

- [ ] **Step 5: Make cart stock representation policy-aware**

Change `SaleLineItem.stock` to `number | null`; existing persisted numeric values remain compatible and recent-only products use `null`.

Extend the store APIs without changing their strict default:

```ts
updateSaleQty: (
  productId: number,
  qty: number,
  options?: { enforceStock?: boolean },
) => void;
hasStockIssues: (options?: { enforceStock?: boolean }) => boolean;
getStockIssues: (options?: { enforceStock?: boolean }) => StockIssue[];
```

When `enforceStock === false`, quantity is any positive integer and null/zero/stale stock does not cap it. In `app/sale/[stopId].tsx`, compute:

```ts
const enforceCapturedStock =
  isOnline && inventoryFreshness === 'authoritative';
```

Pass `enforceStock: enforceCapturedStock` to text and +/- quantity changes and to the early `hasStock`/`if (!hasStock)` guard. Render null stock as `Stock sin validar`. Reconnecting with cached/unknown data must not turn stale captured stock into a blocker.

- [ ] **Step 6: Prove other consumers stay strict**

The wiring test must assert:

- `app/sale/[stopId].tsx` passes `stockPolicy="offline_sale"`;
- `app/presale.tsx` does not;
- `app/consignment/[stopId].tsx` does not.

- [ ] **Step 7: Run policy and wiring tests**

```bash
node --test --experimental-strip-types \
  tests/productStockPolicy.test.ts \
  tests/productPickerStockPolicyWiring.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/domain/ProductPicker.tsx src/stores/useVisitStore.ts src/services/productStockPolicy.ts 'app/sale/[stopId].tsx' tests/productStockPolicy.test.ts tests/productPickerStockPolicyWiring.test.mjs
git commit -m "feat: allow referential product selection offline"
```

### Task 5: Connectivity-aware confirm guard and authoritative refresh

**Files:**
- Modify: `app/sale/[stopId].tsx`
- Create: `src/services/saleStockEnforcement.ts`
- Create: `tests/saleStockEnforcement.test.ts`
- Modify: `tests/offlineSaleWiring.test.mjs`

- [ ] **Step 1: Write failing enforcement tests**

Test:

```ts
assert.equal(shouldEnforceFreshSaleStock({
  isOnline: false,
  policy: 'offline_sale',
  inventoryFreshness: 'cached',
}), false);
```

Online with cached/unknown returns `{ allowConfirm: false, shouldRefresh: true }`. Online authoritative returns strict validation.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --test --experimental-strip-types tests/saleStockEnforcement.test.ts
```

- [ ] **Step 3: Implement pure enforcement helper**

Keep NetInfo status and inventory authority as separate inputs.

- [ ] **Step 4: Wire sale screen**

Make the authority-refresh branch the first stock-related branch in `handleConfirm`, before the legacy `hasStock` check and before `findFreshStockIssues`:

- offline + `offline_sale`: validate only positive finite quantity;
- online + non-authoritative catalog: trigger `loadProductsAuthoritative`, show `Actualizando inventario`, and block new lines/confirm until success;
- online + authoritative: run existing `findFreshStockIssues`.

Derive one `onlineInventoryReady` boolean for the Add Product button and confirm button. While refresh is in flight, both are disabled and the UI shows the refresh state. If authority is still unavailable, do not fall through to a misleading `Stock insuficiente` alert.

- [ ] **Step 5: Record recent products**

After the sale recovery intent and queue item are durably saved, call `recordRecentProducts(saleLines)`. A later Odoo rejection does not remove them.

- [ ] **Step 6: Run focused sale tests**

```bash
node --test --experimental-strip-types \
  tests/saleStockEnforcement.test.ts \
  tests/saleStockValidation.test.ts \
  tests/offlineSaleWiring.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add 'app/sale/[stopId].tsx' src/services/saleStockEnforcement.ts tests/saleStockEnforcement.test.ts tests/offlineSaleWiring.test.mjs
git commit -m "feat: bypass stale stock only for offline sales"
```

### Task 6: Durable insufficient-stock classification

**Files:**
- Modify: `src/types/sync.ts`
- Create: `src/services/syncErrorClassification.ts`
- Create: `tests/syncErrorClassification.test.ts`
- Modify: `src/stores/useSyncStore.ts`
- Modify: `tests/syncSaleTerminalWiring.test.mjs`
- Modify: `tests/saleDefinitiveFailureWiring.test.mjs`

- [ ] **Step 1: Add optional durable error code**

Add:

```ts
error_code?: string | null;
```

Legacy queue items without it remain valid.

- [ ] **Step 2: Write failing classification tests**

`classifySyncFailure(item, error)` must return:

```ts
{
  retryAutomatically: false,
  terminalStatus: 'dead',
  errorCode: 'insufficient_stock',
  protectFromGenericClear: true,
}
```

Recognize `error.code`, `error.data.error_code`, and the existing compatible insufficient-stock parser. Test ambiguous/network errors remain retryable.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test --experimental-strip-types \
  tests/syncErrorClassification.test.ts \
  tests/syncRetryDecision.test.ts
```

- [ ] **Step 4: Implement classification**

Reuse `getInsufficientStockDetail` and `classifySaleSubmissionError`; do not duplicate message parsing.

- [ ] **Step 5: Persist code before publishing dead state**

Extend `markDead` to accept `errorCode`. In `processOneItem`, classify once and pass the durable code. Queue persistence already retains non-done items; add the code to every object spread.

If strict persistence fails, use the existing deferred-storage path; do not clear the visit or report the rejection as resolved.

- [ ] **Step 6: Run sync tests**

```bash
node --test --experimental-strip-types \
  tests/syncErrorClassification.test.ts \
  tests/syncRetryDecision.test.ts \
  tests/syncSaleTerminalWiring.test.mjs \
  tests/saleDefinitiveFailureWiring.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/sync.ts src/services/syncErrorClassification.ts src/stores/useSyncStore.ts tests/syncErrorClassification.test.ts tests/syncSaleTerminalWiring.test.mjs tests/saleDefinitiveFailureWiring.test.mjs
git commit -m "feat: persist insufficient stock sync failures"
```

### Task 7: Protected cleanup and explicit retry

**Files:**
- Create: `src/services/syncDeadCleanup.ts`
- Create: `tests/syncDeadCleanup.test.ts`
- Modify: `src/services/saleRetry.ts`
- Modify: `tests/saleRetry.test.ts`
- Modify: `src/stores/useSyncStore.ts`
- Modify: `app/sync.tsx`
- Modify: `app/(tabs)/sales.tsx`
- Modify: `app/checkout/[stopId].tsx`
- Modify: `src/services/salesListProjection.ts`
- Modify: `tests/checkoutSalePendingWiring.test.mjs`

- [ ] **Step 1: Write failing cleanup tests**

Test:

```ts
const result = clearUnprotectedDeadItems(queue);
assert.ok(result.queue.some((item) =>
  item.type === 'sale_order' &&
  item.error_code === 'insufficient_stock'
));
assert.equal(result.removed, 1);
assert.equal(result.protected, 1);
```

- [ ] **Step 2: Write failing retry tests**

`rearmSaleOrderForRetry` must:

- retain the same ID;
- set pending/retries 0/next retry null;
- clear `error_message` and `error_code`;
- rearm dead dependents.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test --experimental-strip-types \
  tests/syncDeadCleanup.test.ts \
  tests/saleRetry.test.ts
```

- [ ] **Step 4: Implement cleanup policy**

Make `clearDead()` use the pure helper. Update the confirmation copy to state that stock-rejected sales will remain and report `removed`/`protected` counts.

- [ ] **Step 5: Add public retry action**

Expose:

```ts
retrySaleOrder: (operationId: string) => Promise<void>;
```

The store applies `rearmSaleOrderForRetry`, persists immediately, then runs `processQueue`. Replace direct `useSyncStore.setState` usage in checkout with this action.

- [ ] **Step 6: Add retry buttons**

In Sync and the unified Sales card, show `Reintentar` only for protected `insufficient_stock` sales while online. Use the same store action.

- [ ] **Step 7: Ensure close/cut guards remain blocking**

No guard formula change is expected: the protected item stays `dead`, so `deadCount` continues blocking `cashcloseGuard` and `routeCloseGuard`. Add a regression test that protected dead items count.

- [ ] **Step 8: Run focused tests**

```bash
node --test --experimental-strip-types \
  tests/syncDeadCleanup.test.ts \
  tests/saleRetry.test.ts \
  tests/cashcloseGuard.test.ts \
  tests/routeCloseGuard.test.ts \
  tests/pendingOrders.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/syncDeadCleanup.ts src/services/saleRetry.ts src/stores/useSyncStore.ts app/sync.tsx 'app/(tabs)/sales.tsx' src/services/salesListProjection.ts tests/syncDeadCleanup.test.ts tests/saleRetry.test.ts tests/cashcloseGuard.test.ts tests/routeCloseGuard.test.ts
git add 'app/checkout/[stopId].tsx' tests/checkoutSalePendingWiring.test.mjs
git commit -m "feat: protect and retry rejected offline sales"
```

### Task 8: Full verification

**Files:**
- Modify only for verified regressions.

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 2: Complete test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Diff hygiene**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Manual next-day/offline scenario**

1. Online, load truck products successfully.
2. Close the app and advance to the next local day or use a fixture build.
3. Start offline and verify the last-known catalog appears.
4. Verify a recent-only product also appears.
5. Add a cached zero-stock product and a quantity greater than cached stock.
6. Confirm the ticket/queue sale is created and marked with unvalidated stock copy.
7. Verify preventa and consignación still block according to their original policies.

- [ ] **Step 5: Manual reconnect and rejection scenario**

1. Reconnect while inventory is cached; verify `Actualizando inventario` blocks new additions until authoritative refresh.
2. Force an `insufficient_stock` response.
3. Verify the sale becomes `Requiere atención`, survives restart, and remains after generic “Limpiar historial”.
4. Verify route close, cash close, and liquidation remain blocked.
5. Replenish/adjust backend stock, press `Reintentar`, and verify the same `operation_id` succeeds.
6. Verify the remote order replaces the local Sales card and guards unblock.

- [ ] **Step 6: Commit verification fixes if needed**

```bash
git add <exact-files-fixed>
git commit -m "fix: close offline catalog verification gaps"
```

Skip if no files changed.
