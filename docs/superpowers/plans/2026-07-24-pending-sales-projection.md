# Pending Sales Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show durable queued sales in the Sales tab with clear local sync status, without adding them to official Odoo KPIs or creating duplicates after synchronization.

**Architecture:** Build a pure projection that merges remote `GFSalesOrder` values with local `sale_order` queue items and persisted ticket snapshots. A focused hook loads ticket metadata and reacts to queue transitions; the screen remains a presenter. Reconciliation uses normalized non-empty `operation_id`, while remote orders without one retain stable `odoo:<id>` identities.

**Tech Stack:** TypeScript, React Native/Expo Router, Zustand, existing sync queue and ticket storage, Node 22 test runner.

**Design spec:** `docs/superpowers/specs/2026-07-23-pending-sales-projection-design.md`

**Dependency:** Implement after `2026-07-24-offline-pricing-snapshots.md` so authoritative ticket replacement is already available.

---

## File map

- Create `src/services/salesListProjection.ts`: pure local adaptation, reconciliation, sorting, day filtering, and pending summary.
- Create `src/hooks/useSalesListProjection.ts`: load local tickets and refresh remote sales after a local sale becomes done.
- Modify `src/services/saleTicketStorage.ts`: batch-load local snapshots by operation ID.
- Modify `src/stores/useSalesStore.ts`: support an explicit forced refresh while retaining stale remote data on error.
- Modify `app/(tabs)/sales.tsx`: render the unified list and separate pending summary.
- Extend `src/services/pendingOrders.ts` only if shared status copy avoids duplication.
- Add focused projection/hook-policy/wiring tests.

### Task 1: Pure local sale adaptation

**Files:**
- Create: `src/services/salesListProjection.ts`
- Create: `tests/salesListProjection.test.ts`

- [ ] **Step 1: Write failing local adaptation tests**

Cover all queue states:

```ts
const entry = projectLocalSale(queueItem, ticket);
assert.equal(entry.origin, 'local');
assert.equal(entry.localStatus, 'pending');
assert.equal(entry.customerName, 'Abarrotes Centro');
assert.equal(entry.amountTotal, 115);
```

Add cases for `syncing`, `error`, `dead`, non-`sale_order` exclusion, ticket-preferred fields, payload fallback, and a metadata-free legacy sale:

```ts
assert.equal(legacy.customerName, 'Cliente sin nombre');
assert.equal(legacy.amountTotal, null);
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --test --experimental-strip-types tests/salesListProjection.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement presentation types and local adapter**

Define:

```ts
export type LocalSaleStatus =
  | 'pending'
  | 'syncing'
  | 'retrying'
  | 'needs_attention'
  | 'updating';

export interface SalesListEntry {
  key: string;
  operationId: string;
  origin: 'odoo' | 'local';
  customerName: string;
  amountTotal: number | null;
  kgTotal: number | null;
  createdAtMs: number;
  localStatus?: LocalSaleStatus;
  errorMessage?: string | null;
  remoteOrder?: GFSalesOrder;
}
```

Use `queueItem.id` as the local operation ID and `local:<id>` as the React key.

- [ ] **Step 4: Run focused test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/salesListProjection.ts tests/salesListProjection.test.ts
git commit -m "feat: project queued sales for display"
```

### Task 2: Remote reconciliation and pending totals

**Files:**
- Modify: `src/services/salesListProjection.ts`
- Modify: `tests/salesListProjection.test.ts`

- [ ] **Step 1: Add failing merge tests**

Test:

```ts
const merged = mergeSalesListEntries({
  remoteOrders: [remoteWithOperation('ABC')],
  localEntries: [localWithOperation('abc')],
  localDay: '2026-07-24',
});
assert.equal(merged.length, 1);
assert.equal(merged[0].origin, 'odoo');
```

Also cover:

- trim/case normalization only for comparison;
- multiple remote orders with blank `operation_id` use `odoo:<id>`;
- blank remote IDs never reconcile;
- date-descending order;
- local-day filtering;
- remote order wins.

- [ ] **Step 2: Add failing pending-summary tests**

```ts
assert.deepEqual(summarizeLocalSales(entries), {
  count: 3,
  knownAmountTotal: 150,
  unknownAmountCount: 1,
  needsAttentionCount: 1,
});
```

`dead` contributes to attention count, not known pending amount. Confirm official remote summary is not an input to this function.

- [ ] **Step 3: Run focused test and verify RED**

Use the Task 1 command.

- [ ] **Step 4: Implement merge and summary**

Export:

```ts
export function normalizeOperationIdForComparison(value: string): string;
export function mergeSalesListEntries(input: MergeSalesListInput): SalesListEntry[];
export function summarizeLocalSales(entries: SalesListEntry[]): LocalSalesSummary;
```

Only non-empty normalized IDs enter the reconciliation index.

- [ ] **Step 5: Run focused test**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/salesListProjection.ts tests/salesListProjection.test.ts
git commit -m "feat: reconcile local and Odoo sales"
```

### Task 3: Batch ticket loading and projection input

**Files:**
- Modify: `src/services/saleTicketStorage.ts`
- Create: `tests/saleTicketBatchLoad.test.ts`
- Create: `src/services/localSaleTickets.ts`
- Create: `tests/localSaleTickets.test.ts`

- [ ] **Step 1: Write failing batch-load tests with an injected loader**

Test deduplicated operation IDs, missing tickets, legacy snapshots, and one failed read not dropping other tickets.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test --experimental-strip-types \
  tests/saleTicketBatchLoad.test.ts \
  tests/localSaleTickets.test.ts
```

- [ ] **Step 3: Implement batch load**

Add:

```ts
export async function loadSaleTicketSnapshots(
  saleIds: string[],
): Promise<Map<string, SaleTicketSnapshot>>;
```

Use `Promise.allSettled`, trim IDs, and return a map keyed by the original queue ID. Keep `loadSaleTicketSnapshot` unchanged.

- [ ] **Step 4: Implement queue-to-ticket input helper**

`collectLocalSaleOperationIds(queue)` returns only non-done `sale_order` IDs, deduplicated in queue order. Keep it pure.

- [ ] **Step 5: Run focused tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/saleTicketStorage.ts src/services/localSaleTickets.ts tests/saleTicketBatchLoad.test.ts tests/localSaleTickets.test.ts
git commit -m "feat: load tickets for queued sales"
```

### Task 4: Refresh policy after sync completion

**Files:**
- Create: `src/services/salesRefreshPolicy.ts`
- Create: `tests/salesRefreshPolicy.test.ts`
- Modify: `src/stores/useSalesStore.ts`

- [ ] **Step 1: Write failing transition-policy tests**

The pure policy receives previous/current sale statuses:

```ts
assert.equal(shouldRefreshSalesAfterQueueChange({
  previous: new Map([['op-1', 'syncing']]),
  current: new Map([['op-1', 'done']]),
}), true);
```

Pending→error and unrelated queue changes return false.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --test --experimental-strip-types tests/salesRefreshPolicy.test.ts
```

- [ ] **Step 3: Implement the pure policy**

Compare only `sale_order` IDs. A newly observed `done` also refreshes.

- [ ] **Step 4: Add force refresh to `useSalesStore`**

Change:

```ts
loadTodaySales: (options?: { force?: boolean }) => Promise<void>;
```

`force` bypasses the `isLoading` early return only by coalescing to the active request; do not start concurrent remote loads. On error, preserve prior `summary` and `orders`.

- [ ] **Step 5: Add/adjust store wiring test**

Use a structural `.mjs` test if importing Zustand/React Native in Node is impractical. Assert that errors do not reset remote data.

- [ ] **Step 6: Run focused tests**

```bash
node --test --experimental-strip-types \
  tests/salesRefreshPolicy.test.ts \
  tests/salesFrontendWiring.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/salesRefreshPolicy.ts src/stores/useSalesStore.ts tests/salesRefreshPolicy.test.ts tests/salesFrontendWiring.test.mjs
git commit -m "feat: refresh sales after queue completion"
```

### Task 5: Projection hook

**Files:**
- Create: `src/hooks/useSalesListProjection.ts`
- Create: `tests/useSalesListProjectionWiring.test.mjs`

- [ ] **Step 1: Write failing wiring assertions**

Require the hook to:

- subscribe to `useSyncStore.queue`;
- collect local sale IDs;
- batch-load tickets when the relevant queue signature changes;
- build local entries and merge with `useSalesStore.orders`;
- trigger forced refresh only through `shouldRefreshSalesAfterQueueChange`;
- retain local entries if remote load fails.

- [ ] **Step 2: Run wiring test and verify RED**

```bash
node --test tests/useSalesListProjectionWiring.test.mjs
```

- [ ] **Step 3: Implement the hook**

Expose:

```ts
export function useSalesListProjection(): {
  entries: SalesListEntry[];
  localSummary: LocalSalesSummary;
  ticketsLoading: boolean;
};
```

Use a stable queue signature of relevant fields (`id`, `status`, `error_message`, `created_at`) so GPS updates do not reload tickets.

- [ ] **Step 4: Run hook wiring test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSalesListProjection.ts tests/useSalesListProjectionWiring.test.mjs
git commit -m "feat: expose unified sales projection"
```

### Task 6: Sales tab statuses and separate pending summary

**Files:**
- Modify: `app/(tabs)/sales.tsx`
- Create: `src/services/localSaleStatusCopy.ts`
- Create: `tests/localSaleStatusCopy.test.ts`
- Modify: `tests/salesFrontendWiring.test.mjs`
- Modify: `tests/saleTicketWiring.test.mjs`

- [ ] **Step 1: Write failing status-copy tests**

Map:

```ts
pending -> "Pendiente de sincronizar"
syncing -> "Sincronizando"
retrying -> "Reintentando"
needs_attention -> "Requiere atención"
updating -> "Actualizando"
```

Return tone tokens rather than hard-coded component colors.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --test --experimental-strip-types tests/localSaleStatusCopy.test.ts
```

- [ ] **Step 3: Replace remote-only list rendering**

Use `useSalesListProjection()`. Preserve existing KPI values from `useSalesStore.summary` only.

Render a pending card above PEDIDOS:

```text
Pendiente de sincronizar
$1,250.00 · 2 ventas
1 venta sin monto
```

Render local status badges and error messages. A null amount shows `Monto no disponible`.

- [ ] **Step 4: Keep ticket navigation source-aware**

- Local: load `sale-ticket:<operationId>` and navigate to `/print/<operationId>`.
- Remote: save authoritative Odoo snapshot, then navigate.
- Missing local ticket: keep card enabled only after load completes; otherwise show a recoverable message.

- [ ] **Step 5: Update wiring tests**

Assert:

- official KPI reads only `summary`;
- projection entries drive the list;
- local summary is separate;
- local and remote ticket paths are distinct;
- list keys come from `SalesListEntry.key`.

- [ ] **Step 6: Run focused UI tests**

```bash
node --test --experimental-strip-types \
  tests/localSaleStatusCopy.test.ts \
  tests/salesFrontendWiring.test.mjs \
  tests/saleTicketWiring.test.mjs \
  tests/salesListLinesWiring.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add 'app/(tabs)/sales.tsx' src/services/localSaleStatusCopy.ts tests/localSaleStatusCopy.test.ts tests/salesFrontendWiring.test.mjs tests/saleTicketWiring.test.mjs
git commit -m "feat: show pending sales in Sales tab"
```

### Task 7: Full verification

**Files:**
- Modify only for regressions found during verification.

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 2: Complete tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Diff hygiene**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Manual offline-to-online scenario**

1. Create a sale in airplane mode.
2. Open Sales and verify the local card appears immediately.
3. Confirm official Sold/Orders/Kg KPI did not change.
4. Restart the app and confirm the local card/ticket remain.
5. Reconnect and observe Pending → Syncing → Updating.
6. Confirm one Odoo card replaces the local card without duplication.
7. Verify the official KPI updates only after the remote refresh.
8. Inject or reproduce a terminal error and confirm `Requiere atención` remains visible.

- [ ] **Step 5: Commit verification fixes if needed**

```bash
git add <exact-files-fixed>
git commit -m "fix: close pending sales projection gaps"
```

Skip if no files changed.

