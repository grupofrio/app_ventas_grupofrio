# Authoritative Route Start Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Odoo's route-plan state authoritative so a plan already started with KM, checklist, and initial load cannot be blocked by stale or cleared phone state.

**Architecture:** Add pure plan-to-readiness normalization, synchronize it atomically into the plan-scoped route-start store whenever a plan is hydrated or downloaded, and make the operation gate evaluate the exhaustive Odoo plan state. Wire the existing Odoo start endpoint through a testable orchestration helper so the button confirms `in_progress` before navigating and recovers from ambiguous network failures.

**Tech Stack:** Expo Router, React Native, TypeScript, Zustand, AsyncStorage persistence, Node's built-in test runner, Odoo REST endpoints.

---

## File map

- Create `src/services/routeStartAuthority.ts`: pure normalization of Odoo plan KM, initial-load readiness, plan state, and plan-scoped store merge.
- Create `src/services/routeStartAction.ts`: dependency-injected, testable start mutation/recovery orchestration.
- Modify `src/services/routeLoadAcceptance.ts`: expose initial-load-only state so refills never reset daily readiness.
- Modify `src/services/operationReadiness.ts`: exhaustive `PlanState` decision table with transaction/close modes.
- Modify `src/services/gfLogistics.ts`: typed `startPlan(planId)` transport for the existing employee endpoint.
- Modify `src/stores/useRouteStartStore.ts`: atomic `syncFromPlan` action that preserves checklist only for the same plan.
- Modify `src/stores/useRouteStore.ts`: synchronize each downloaded plan and expose a local `markPlanStarted` action.
- Modify `src/services/rehydrate.ts`: bind the cached plan to the cached readiness after validating day and employee.
- Modify `src/components/OperationGate.tsx`: pass plan state and plan identity to pure readiness logic; add close mode.
- Modify `app/route-close.tsx`: opt into close mode.
- Modify `app/route-start.tsx`: preserve checklist on transient failures, start on the server, prevent double taps, and navigate only after authoritative confirmation.
- Modify `app/checklist/[planId].tsx`: write checklist completion/KM only to the plan that originated the async request.
- Tests: `tests/routeStartAuthority.test.ts`, `tests/routeStartAction.test.ts`, `tests/operationReadiness.test.ts`, `tests/routeLoadAcceptance.test.ts`, `tests/routeStartAuthoritativeWiring.test.mjs`.

### Task 1: Normalize authoritative KM and initial load

**Files:**
- Create: `src/services/routeStartAuthority.ts`
- Modify: `src/services/routeLoadAcceptance.ts:27-150`
- Create: `tests/routeStartAuthority.test.ts`
- Modify: `tests/routeLoadAcceptance.test.ts`

- [ ] **Step 1: Write failing tests for the field case and refill isolation**

Add cases that assert:

```ts
const aleman = deriveRouteStartPlanSnapshot({
  plan_id: 6466,
  state: 'in_progress',
  departure_km: 399728,
  load_picking_id: 80,
  load_pickings: [{ picking_id: 80, load_kind: 'initial', accepted: true }],
} as GFPlan);
assert.deepEqual(aleman, {
  planId: 6466,
  planState: 'in_progress',
  kmInitial: 399728,
  initialLoadAccepted: true,
});

const withPendingRefill = buildInitialLoadAcceptanceState({
  load_picking_id: 80,
  load_pickings: [
    { picking_id: 80, load_kind: 'initial', accepted: true },
    { picking_id: 81, load_kind: 'refill', accepted: false, state: 'assigned' },
  ],
  pending_loads: [
    { picking_id: 81, load_kind: 'refill', accepted: false, state: 'assigned' },
  ],
});
assert.equal(withPendingRefill.initialLoadAccepted, true);
```

Also test `departure_km` values `null`, `0`, negative, and `NaN` normalize to `null`; a pending initial load normalizes to `false`; no initial load normalizes to `true` (skip).

Add a regression for the public sale helper:

```ts
assert.equal(canStartSaleWithRouteLoad(planWithAcceptedInitialAndPendingRefill), true);
assert.equal(canStartSaleWithRouteLoad(planWithPendingInitialLoad), false);
```

This is required because Venta already calls `canStartSaleWithRouteLoad`; isolating only the route-start card would still let a pending refill re-block Venta.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --experimental-strip-types tests/routeStartAuthority.test.ts
node --experimental-strip-types tests/routeLoadAcceptance.test.ts
```

Expected: FAIL because `deriveRouteStartPlanSnapshot` and `buildInitialLoadAcceptanceState` do not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

Extend the load state with a focused helper:

```ts
export interface InitialLoadAcceptanceState {
  initialLoads: RouteLoadCard[];
  pendingInitialLoads: RouteLoadCard[];
  initialLoadAccepted: boolean;
  nextPendingInitialLoad: RouteLoadCard | null;
}

export function buildInitialLoadAcceptanceState(plan: unknown): InitialLoadAcceptanceState {
  const state = buildRouteLoadAcceptanceState(plan);
  const initialLoads = state.loadCards.filter((card) => !card.isRefill);
  const pendingInitialLoads = state.pendingLoads.filter((card) => !card.isRefill);
  return {
    initialLoads,
    pendingInitialLoads,
    initialLoadAccepted: initialLoads.length === 0 || pendingInitialLoads.length === 0,
    nextPendingInitialLoad: pendingInitialLoads[0] || null,
  };
}
```

Change `canStartSaleWithRouteLoad(plan)` to return
`buildInitialLoadAcceptanceState(plan).initialLoadAccepted`. Refill acceptance
remains enforced by its dedicated refill screen, not by the daily-start sale
gate.

Create the authority module:

```ts
import type { GFPlan, PlanState } from '../types/plan';
import { buildInitialLoadAcceptanceState } from './routeLoadAcceptance';

export interface RouteStartPlanSnapshot {
  planId: number;
  planState: PlanState;
  kmInitial: number | null;
  initialLoadAccepted: boolean;
}

function positiveKm(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function deriveRouteStartPlanSnapshot(plan: GFPlan): RouteStartPlanSnapshot {
  return {
    planId: Number(plan.plan_id),
    planState: plan.state,
    kmInitial: positiveKm(plan.departure_km),
    initialLoadAccepted: buildInitialLoadAcceptanceState(plan).initialLoadAccepted,
  };
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same two commands. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/routeStartAuthority.ts src/services/routeLoadAcceptance.ts tests/routeStartAuthority.test.ts tests/routeLoadAcceptance.test.ts
git commit -m "fix: normalize authoritative route start data"
```

### Task 2: Synchronize plan data atomically and safely across restarts

**Files:**
- Modify: `src/services/routeStartAuthority.ts`
- Modify: `src/stores/useRouteStartStore.ts:20-131`
- Modify: `src/stores/useRouteStore.ts:48-255`
- Modify: `src/services/rehydrate.ts:48-100`
- Modify: `tests/routeStartAuthority.test.ts`
- Create: `tests/routeStartAuthoritativeWiring.test.mjs`

- [ ] **Step 1: Write failing plan-scope and wiring tests**

Add pure merge cases:

```ts
assert.deepEqual(
  mergeRouteStartPlanSnapshot(
    { planId: 6466, checklistComplete: false, kmInitial: null, loadAccepted: false },
    { planId: 6466, planState: 'in_progress', kmInitial: 399728, initialLoadAccepted: true },
  ),
  { planId: 6466, checklistComplete: false, kmInitial: 399728, loadAccepted: true },
);

assert.deepEqual(
  mergeRouteStartPlanSnapshot(
    { planId: 1, checklistComplete: true, kmInitial: 111, loadAccepted: true },
    { planId: 2, planState: 'published', kmInitial: null, initialLoadAccepted: false },
  ),
  { planId: 2, checklistComplete: false, kmInitial: null, loadAccepted: false },
);
```

The static wiring test must require:

- `useRouteStartStore` exports/implements `syncFromPlan`.
- `useRouteStore.loadPlan` calls `syncFromPlan(plan)` before both plan-set branches.
- `rehydrateAppState` calls `syncFromPlan(plan)` only inside the validated same-day/same-employee branch.
- The route-start refresh no longer only calls `setKmInitialBackend` without synchronizing the store.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --experimental-strip-types tests/routeStartAuthority.test.ts
node tests/routeStartAuthoritativeWiring.test.mjs
```

Expected: FAIL on missing merge/action/wiring.

- [ ] **Step 3: Implement pure merge and store action**

Add:

```ts
export interface RouteStartPersistedFacts {
  planId: number | null;
  checklistComplete: boolean;
  kmInitial: number | null;
  loadAccepted: boolean;
}

export function mergeRouteStartPlanSnapshot(
  current: RouteStartPersistedFacts,
  snapshot: RouteStartPlanSnapshot,
): RouteStartPersistedFacts {
  return {
    planId: snapshot.planId,
    checklistComplete: current.planId === snapshot.planId
      ? current.checklistComplete
      : false,
    kmInitial: snapshot.kmInitial,
    loadAccepted: snapshot.initialLoadAccepted,
  };
}
```

Add `syncFromPlan(plan: GFPlan)` to the Zustand store. It must perform one `set`, recompute readiness once, persist once, and log the plan/state without credentials.

- [ ] **Step 4: Wire online and offline plan entry points**

In `useRouteStore.loadPlan`, call `useRouteStartStore.getState().syncFromPlan(plan)` immediately after the non-null plan response and before the stop-version early return.

In `rehydrateAppState`, after day and employee validation and before exposing the cached plan, call the same action. Do not sync rejected/stale cached plans.

When a definitive online read returns no plan and cached fallback is not retained, reset the route-start store.

- [ ] **Step 5: Run focused tests, typecheck, and verify GREEN**

```bash
node --experimental-strip-types tests/routeStartAuthority.test.ts
node tests/routeStartAuthoritativeWiring.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/routeStartAuthority.ts src/stores/useRouteStartStore.ts src/stores/useRouteStore.ts src/services/rehydrate.ts tests/routeStartAuthority.test.ts tests/routeStartAuthoritativeWiring.test.mjs
git commit -m "fix: rehydrate route readiness from Odoo plan"
```

### Task 3: Make operation gating exhaustive and server-authoritative

**Files:**
- Modify: `src/services/operationReadiness.ts:20-51`
- Modify: `src/components/OperationGate.tsx:28-83`
- Modify: `app/route-close.tsx:423-431`
- Modify: `tests/operationReadiness.test.ts`
- Modify: `tests/routeStartAuthoritativeWiring.test.mjs`

- [ ] **Step 1: Write the exhaustive failing state-table tests**

Change input to:

```ts
{
  planState: PlanState | null;
  planMatchesReadiness: boolean;
  checklistDone: boolean;
  kmCaptured: boolean;
  loadAccepted: boolean;
  mode?: 'transaction' | 'close';
}
```

Test every state:

- `null`, `draft`, `confirmed`: blocked.
- `published`: blocked; when facts are missing they are listed, otherwise reason asks to confirm route start. For the same plan with all facts true, only confirmation is missing; for a mismatched persisted `planId`, checklist/KM/load must still be listed even if the old flags are all true. This proves `planMatchesReadiness` is actually used.
- `in_progress`: transaction and close allowed even when the persisted KM flag is false or belongs to an older plan (the Alemán case). The current Odoo plan state is the authorization; persisted prerequisite facts cannot degrade it.
- `closed`, `reconciled`, `done`: transactions blocked, close mode allowed.
- Mismatched readiness never authorizes a `published` plan.

- [ ] **Step 2: Run and verify RED**

```bash
node --experimental-strip-types tests/operationReadiness.test.ts
```

Expected: FAIL because the old API only accepts `hasActivePlan` and prerequisites.

- [ ] **Step 3: Implement the exhaustive pure decision**

Use an explicit switch on `planState`; do not rely on truthiness or state ordering. Preserve the existing human-readable missing-fields reason for `published`, but add distinct messages for unpublished, not-yet-confirmed, and finished routes.

- [ ] **Step 4: Wire the component and close mode**

`OperationGate` reads the plan object and route-start `planId`, passes `plan.state`, and sets `planMatchesReadiness = plan.plan_id === routeStart.planId`. Add optional `mode` prop defaulting to `transaction`. `route-close.tsx` passes `mode="close"`.

- [ ] **Step 5: Run tests and typecheck**

```bash
node --experimental-strip-types tests/operationReadiness.test.ts
node tests/routeStartAuthoritativeWiring.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/operationReadiness.ts src/components/OperationGate.tsx app/route-close.tsx tests/operationReadiness.test.ts tests/routeStartAuthoritativeWiring.test.mjs
git commit -m "fix: trust started Odoo plans in operation gate"
```

### Task 4: Confirm the route start mutation before navigating

**Files:**
- Create: `src/services/routeStartAction.ts`
- Modify: `src/services/gfLogistics.ts:343-364,550-556`
- Modify: `src/stores/useRouteStore.ts:48-69,255-330`
- Create: `tests/routeStartAction.test.ts`
- Modify: `tests/routeStartAuthoritativeWiring.test.mjs`

- [ ] **Step 1: Write failing service and orchestration tests**

Define expected transport result:

```ts
export interface StartPlanResult {
  planId: number;
  state: 'in_progress';
}
```

Test orchestration scenarios with dependency functions (no network mocks):

1. Local state already `in_progress`: do not call mutation; return success.
2. Mutation success: mark local plan, attempt one refresh, return success even if refresh fails.
3. Mutation throws timeout: refresh once; matching `in_progress` recovers as success.
4. Mutation throws and refresh remains `published`: rethrow original error.
5. Refreshed `in_progress` belongs to another plan: do not recover.

Add static assertions that `startPlan` posts to `${GF_BASE}/plan/start` with exactly `{ plan_id: planId }` and validates `data.state`.

- [ ] **Step 2: Run and verify RED**

```bash
node --experimental-strip-types tests/routeStartAction.test.ts
node tests/routeStartAuthoritativeWiring.test.mjs
```

Expected: FAIL because service/orchestrator/route action are missing.

- [ ] **Step 3: Implement typed transport**

In `gfLogistics.ts`:

```ts
export async function startPlan(planId: number): Promise<StartPlanResult> {
  const result = await postRest<any>(`${GF_BASE}/plan/start`, { plan_id: planId });
  const data = result?.data ?? result;
  if (Number(data?.plan_id) !== planId || data?.state !== 'in_progress') {
    throw new Error('Odoo no confirmó el inicio de la ruta.');
  }
  return { planId, state: 'in_progress' };
}
```

- [ ] **Step 4: Implement dependency-injected recovery helper**

`confirmAuthoritativeRouteStart` receives `{ planId, currentState, start, refresh, markStarted }`. On mutation success, call `markStarted` before best-effort refresh. On mutation error, refresh once and recover only when the same plan is `in_progress`; otherwise throw the original error.

- [ ] **Step 5: Add `markPlanStarted(planId)` to the route store**

Patch only a matching current plan, persist the patched plan, and synchronize the route-start store. Do nothing for a mismatched plan ID.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
node --experimental-strip-types tests/routeStartAction.test.ts
node tests/routeStartAuthoritativeWiring.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/routeStartAction.ts src/services/gfLogistics.ts src/stores/useRouteStore.ts tests/routeStartAction.test.ts tests/routeStartAuthoritativeWiring.test.mjs
git commit -m "fix: confirm route start with Odoo"
```

### Task 5: Wire the route-start UI and reproduce the video sequence

**Files:**
- Modify: `app/route-start.tsx:78-203,410-443`
- Modify: `app/checklist/[planId].tsx`
- Modify: `src/stores/useRouteStartStore.ts`
- Modify: `tests/routeStartChecklistKmWiring.test.mjs`
- Modify: `tests/routeStartAuthoritativeWiring.test.mjs`

- [ ] **Step 1: Extend failing wiring tests for the exact video**

Require that:

- The refreshed plan's KM is synchronized into `useRouteStartStore`, not only component-local state.
- A checklist request failure preserves the matching plan's previous checklist fact instead of forcing `false`.
- `in_progress` makes the route button a “Continuar ruta” action independent of transient local readiness.
- The button invokes `confirmAuthoritativeRouteStart` before `router.replace`.
- A `startingRoute` flag disables double taps and shows loading.

- [ ] **Step 2: Run wiring tests and verify RED**

```bash
node tests/routeStartChecklistKmWiring.test.mjs
node tests/routeStartAuthoritativeWiring.test.mjs
```

Expected: FAIL on missing server synchronization/start ordering.

- [ ] **Step 3: Preserve factual checklist state correctly**

Select `checklistComplete` from `useRouteStartStore` and add plan-scoped actions `setChecklistCompleteForPlan(planId, done)` and `setKmInitialForPlan(planId, km)`. Each action must no-op unless `get().planId === planId`. On a successful checklist response, apply it through the scoped checklist action. On failure, preserve the current value only if the store still belongs to the captured plan; otherwise show the new plan as pending. This prevents an awaited refresh/checklist request for plan A from writing its result into plan B.

`checklistDoneLive` must be derived from the plan-scoped persisted fact (plus the current plan's authoritative `in_progress` state), not from a free component-local status. `checklistStatus` may remain for rendering/loading feedback, but success and failure handlers may call `setChecklistStatus` only after verifying `useRouteStore.getState().plan?.plan_id === capturedPlanId` and `useRouteStartStore.getState().planId === capturedPlanId`. A late response for plan A therefore cannot paint plan B as ready.

Use `setKmInitialForPlan(capturedPlanId, storedKm)` after every awaited KM mutation in both `app/route-start.tsx` and `app/checklist/[planId].tsx`. Apply the same current-plan guard before updating component-local KM display/input state. The existing unscoped setters may remain for synchronous internal use, but async UI paths must use the scoped variants.

Add race tests to `routeStartAuthoritativeWiring.test.mjs` (and pure/store tests where practical) requiring the captured `planId` argument on every asynchronous checklist and KM write. Require `checklistDoneLive` to use the plan-scoped store fact and require local UI setters to be guarded by the current plan identity. Update `app/checklist/[planId].tsx` to use the same scoped actions so completing an old screen cannot mark a newly loaded plan complete or install its odometer.

- [ ] **Step 4: Replace navigation-only button with async start**

Add `startingRoute` state and `handleStartRoute()`:

```ts
await confirmAuthoritativeRouteStart({
  planId,
  currentState: plan?.state ?? null,
  start: startPlan,
  refresh: async () => {
    await loadPlan({ force: true });
    return useRouteStore.getState().plan;
  },
  markStarted: () => useRouteStore.getState().markPlanStarted(planId),
});
router.replace({ pathname: '/(tabs)/route', params: { view: 'map' } } as never);
```

Catch real errors into an Alert and remain on the screen. Define:

```ts
const serverStarted = plan?.state === 'in_progress';
const canRequestStart = plan?.state === 'published' && readyToStartLive;
const canContinue = serverStarted || canRequestStart;
```

The disabled condition is `startingRoute || !canContinue`. `handleStartRoute` must also guard with the same explicit state check, so `draft`, `confirmed`, `closed`, `reconciled`, and `done` can never reach the endpoint even if a stale render or programmatic call bypasses the button. Add wiring/pure cases for every non-startable state.

After `confirmAuthoritativeRouteStart` resolves and immediately before
`router.replace`, re-read both stores and require:

```ts
const currentPlan = useRouteStore.getState().plan;
const currentStartPlanId = useRouteStartStore.getState().planId;
const stillSameStartedPlan =
  currentPlan?.plan_id === capturedPlanId &&
  currentPlan.state === 'in_progress' &&
  currentStartPlanId === capturedPlanId;
```

If this is false, do not navigate; show “La ruta cambió mientras se iniciaba.
Revisa el plan actual.” This handles mutation success for plan A followed by a
refresh/switch to plan B. Add a wiring and orchestration/UI decision test for
that exact race.

- [ ] **Step 5: Keep initial load and refill UI separate**

Use `buildInitialLoadAcceptanceState` for Step 4 readiness/button. A pending refill continues to render in its dedicated refill flow and cannot make a started plan look unstarted.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
node tests/routeStartChecklistKmWiring.test.mjs
node tests/routeStartAuthoritativeWiring.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/route-start.tsx app/checklist/[planId].tsx src/stores/useRouteStartStore.ts tests/routeStartChecklistKmWiring.test.mjs tests/routeStartAuthoritativeWiring.test.mjs
git commit -m "fix: keep route start UI aligned with Odoo"
```

### Task 6: Full verification and Android release readiness

**Files:**
- Modify if needed: `docs/KOLDFIELD_APK_QA_BUILD.md`

- [ ] **Step 1: Run all automated checks**

```bash
npm run typecheck
npm test
```

Expected: TypeScript exits 0; all tests pass (baseline 131 plus new tests).

- [ ] **Step 2: Run Android release build**

```bash
npm run build:field-update:android
```

Expected: Gradle `BUILD SUCCESSFUL` and a release APK under `android/app/build/outputs/apk/release/`.

- [ ] **Step 3: Verify the release artifact**

```bash
npm run verify:field-update:android
```

Expected: release verification succeeds and reports the expected package/version metadata.

- [ ] **Step 4: Manual acceptance scenario**

On a test device/account:

1. Clear app storage/cache and sign in.
2. Load an Odoo plan already `in_progress` with `departure_km > 0`.
3. Confirm “Iniciar operación” shows the backend KM.
4. Open Venta directly; it must not show “Ruta no iniciada”.
5. Restart offline; with the same cached plan, Venta remains available.
6. Load a different `published` plan; prior KM/checklist cannot authorize it.

- [ ] **Step 5: Commit QA notes if changed**

```bash
git add docs/KOLDFIELD_APK_QA_BUILD.md
git commit -m "docs: record authoritative route start QA"
```
