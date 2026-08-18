# Invoice Collection Visit UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual collection stub with a scoped, invoice-by-invoice visit action that safely captures and reconciles online-only collection intents.

**Architecture:** The screen is entered with the route stop ID, reads only its encrypted day-bundle invoice snapshots, and delegates durable capture/replay to the existing Invoice Collection service. A small presentation layer maps snapshots and encrypted intents to UI states, while the transport normalizes the `{ok, data}` GF envelope before the sync processor sees it. A nonterminal intent is the sole local claim for a stop/invoice pair, so restart and retry reuse it rather than minting another UUID.

**Tech Stack:** Expo Router, React Native, TypeScript, Zustand, encrypted session records, Node test runner, GF Employee Bearer REST.

---

## File structure

- `src/services/invoiceCollection.ts` — strict DTO validation and GF envelope parsing.
- `src/services/invoiceCollectionPersistence.ts` — encrypted serialized lookup/insert for one nonterminal intent per stop and invoice.
- `src/services/invoiceCollectionSync.ts` — production capture composition, not a generic queue.
- `src/services/invoiceCollectionVisit.ts` (new) — pure snapshot/intent view-model and amount validation for the screen.
- `app/collect/[stopId].tsx` — scoped selection, amount/method UI, pending/review feedback.
- `app/checkin/[stopId].tsx` — passes the stop ID to Cobrar.
- `tests/noRawFontSizeOutsideBaseline.test.mjs` — update the approved screen-path baseline during the route replacement.
- `src/services/collectPaymentIntent.ts` and its test — remove obsolete manual-controller remnants only after no caller exists.

## Task 0: Preserve the approved design before rebasing

**Files:**
- Modify: `docs/superpowers/specs/2026-08-18-invoice-collection-visit-ui-design.md`
- Create: `docs/superpowers/plans/2026-08-18-invoice-collection-visit-ui.md`

- [ ] **Step 1: Inspect the isolated worktree**

Run `git status --short --branch`.

Expected: only the approved design/plan documentation is uncommitted; no checkout-principal files are touched.

- [ ] **Step 2: Verify documentation formatting**

Run `git diff --check` and inspect the document diff.

Expected: clean diff with the approved scope only.

- [ ] **Step 3: Commit the documentation atomically**

Run `git status --short` immediately before the commit, then stage exactly the design and plan and commit with `docs(collection): plan scoped visit invoice collection`.

Expected: worktree clean, allowing Task 1 rebase to run without stashing or mixing changes.

## Task 1: Rebase the isolated branch and normalize GF responses

**Files:**
- Modify: `src/services/invoiceCollection.ts:109-159`
- Modify: `tests/invoiceCollectionIntent.test.ts`
- Modify: `tests/invoiceCollectionTransport.test.mjs`

- [ ] **Step 1: Rebase before implementation**

Run:

```bash
git fetch origin
git rebase origin/main
```

Expected: the isolated branch is based on current app main; resolve only semantic conflicts and inspect `git status`.

- [ ] **Step 2: Write failing envelope tests**

Add tests for the actual GF shapes:

```ts
{ ok: true, data: { stop_id: 42, invoices: [{ invoice_id: 9, name: 'FAC-9', invoice_date: null, due_date: null, currency: 'MXN', amount_residual: 25 }] } }
{ ok: true, data: { state: 'applied', operation_id: operationId } }
```

First add exported pure parsers (or an injected narrow `get/post` seam) so tests do not have to mock the dynamic `api.ts` import. Assert the GET parser maps `data.invoices`; the POST success parser maps `data.state`; malformed `{ok:false}` success envelopes reject. Assert HTTP 409 `{ok:false,code:'review_required',data:{state:'review_required'}}` reaches the existing error classifier rather than pretending to be a successful response.

- [ ] **Step 3: Run test to verify RED**

Run: `node --test --experimental-strip-types tests/invoiceCollectionIntent.test.ts tests/invoiceCollectionTransport.test.mjs`

Expected: FAIL because no pure seam exists and the existing parser reads root `invoices` and root `status`.

- [ ] **Step 4: Implement the minimum normalizer**

```ts
function successfulData(value: unknown): Record<string, unknown> {
  const envelope = plainRecord(value);
  if (envelope.ok !== true) throw new Error('La respuesta de cobranza no es válida.');
  return plainRecord(envelope.data);
}
```

Export/test the parsers or inject test-only narrow transports. Use the normalizer only for successful envelopes; preserve `postRest` error metadata for `review_required` and other negative responses. Keep exact DTO allowlists and never accept authority fields.

- [ ] **Step 5: Run test to verify GREEN**

Run the command from Step 3. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status --short
git add src/services/invoiceCollection.ts tests/invoiceCollectionIntent.test.ts tests/invoiceCollectionTransport.test.mjs
git commit -m "fix(collection): parse GF invoice envelopes"
```

## Task 2: Enforce one durable nonterminal intent per invoice

**Files:**
- Modify: `src/services/invoiceCollectionPersistence.ts:19-73`
- Modify: `src/services/invoiceCollectionSync.ts:31-140`
- Modify: `tests/invoiceCollectionPersistence.test.ts`
- Modify: `tests/invoiceCollectionSync.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Insert a `pending` intent for `(stop_id: 5, invoice_id: 8)`, then request a second amount/method/UUID for the same pair. Assert the effective persisted original is returned unchanged. Call capture concurrently with two different UUIDs and assert one durable row, one POST and both callers receive the original UUID/outcome. Assert `applied` does not block a future collection, while `dispatching`, `pending`, and `review_required` do block a new UUID; review is never resent.

Add the remote-success/local-ACK failure regression: server returns `applied`, encrypted transition throws, no in-memory applied is published; after restart the original UUID replays and only a durable ACK publishes `applied`.

- [ ] **Step 2: Run RED**

Run: `node --test --experimental-strip-types tests/invoiceCollectionPersistence.test.ts tests/invoiceCollectionSync.test.ts`

Expected: FAIL because persistence keys uniqueness only by `operation_id`.

- [ ] **Step 3: Implement serialized find-or-insert**

Add a single encrypted-record mutator that finds same `stop_id` and `invoice_id` with `dispatching|pending|review_required`, returning the **effective persisted intent**; otherwise append the new intent and return it. The sync `capture()` must use it before the single-flight map and key single-flight/send by that returned `operation_id`. It can reconcile a pending original, but must surface review unchanged. Do not deduplicate across stops, add a generic queue or create a new UUID.

- [ ] **Step 4: Run GREEN**

Run the command from Step 2. Expected: PASS, including durable-write-before-send, two-UUID concurrency and remote-success/local-ACK recovery.

- [ ] **Step 5: Commit**

```bash
git status --short
git add src/services/invoiceCollectionPersistence.ts src/services/invoiceCollectionSync.ts tests/invoiceCollectionPersistence.test.ts tests/invoiceCollectionSync.test.ts
git commit -m "fix(collection): reuse nonterminal invoice intents"
```

## Task 3: Add a pure visit-collection presentation layer

**Files:**
- Create: `src/services/invoiceCollectionVisit.ts`
- Create: `tests/invoiceCollectionVisit.test.ts`

- [ ] **Step 1: Write failing pure tests**

Test `buildVisitCollectionState(bundle, stopId, intents)`: verify `stopId` exists in validated bundle stops; select exactly one matching `invoice_snapshots.stop_id`; reject duplicate snapshot entries or duplicate invoice IDs; preserve IDs/currency/residual; expose `dispatching|pending` as pending and review as immutable review; reject missing/unknown data; and derive `amount > 0 && amount <= snapshot_residual`. Ensure no partner/company/employee selectors can enter the input.

- [ ] **Step 2: Run RED**

Run: `node --test --experimental-strip-types tests/invoiceCollectionVisit.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement only pure view logic**

Use validated `DayBundle` and `InvoiceCollectionIntent` types. No React, Zustand, network, `partnerId`, or client accounting authority. Treat a stale bundle as readable but not mutation-capable; the screen will apply the existing mutation gate before persistence.

- [ ] **Step 4: Run GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add src/services/invoiceCollectionVisit.ts tests/invoiceCollectionVisit.test.ts
git commit -m "feat(collection): derive scoped visit invoice state"
```

## Task 4: Compose direct capture and replace the manual screen

**Files:**
- Modify: `src/services/invoiceCollectionSync.ts:176-203`
- Delete: `app/collect/[partnerId].tsx`
- Create: `app/collect/[stopId].tsx`
- Modify: `app/checkin/[stopId].tsx:522-533`
- Create: `tests/invoiceCollectionVisitWiring.test.mjs`
- Modify: `tests/invoiceCollectionSync.test.ts`
- Modify: `tests/noRawFontSizeOutsideBaseline.test.mjs`

- [ ] **Step 1: Write failing wiring and behavior tests**

Assert the legacy dynamic route is absent and exactly `app/collect/[stopId].tsx` exists; update the font baseline path. Assert the screen gets `stopId`, never `partnerId`; reads the current day bundle, encrypted current-session intents and a narrow capture helper. Check-in must navigate using `stop.id`. Assert it applies `assertCurrentEmployeeDayBundleAllowsActions()` before encrypted write/network capture, so stale/invalid bundle causes neither. Assert it does not import `useSyncStore`, `defaultPaymentJournalId`, `collectPaymentIntent`, `payments/create`, `postRpc`, or `odooRpc`.

Add a sync test for a production capture helper that delegates to the same encrypted persistence and strict transport as bootstrap, not a second dispatcher.

- [ ] **Step 2: Run RED**

Run `node --test --experimental-strip-types tests/invoiceCollectionSync.test.ts` and `node --test tests/invoiceCollectionVisitWiring.test.mjs`.

Expected: FAIL because the screen is partner/manual/legacy and no direct capture composition exists.

- [ ] **Step 3: Implement direct capture composition and UI**

Export a narrow production helper from `invoiceCollectionSync.ts` that obtains current encrypted persistence and calls the existing processor `capture(intent)`. Reuse the singleton/transport policy; do not add a queue or reconnect runner.

Replace (not duplicate) the dynamic screen with the approved flow: validated bundle and exact stop snapshot; one selected invoice; amount prefilled/bounded from residual; method chips; disabled submit while write/send is active; and exact applied, pending, review and reauth copy. `assertCurrentEmployeeDayBundleAllowsActions()` runs before intent creation. No receipt for pending; no second submit for a nonterminal intent. Following `applied`, invalidate the old selection and require a fresh bundle refresh before any further selection in this screen. Change check-in navigation to `/collect/${stop.id}`.

- [ ] **Step 4: Run GREEN**

Run the Step 2 commands. Expected: PASS.

- [ ] **Step 5: Commit**

Run `git status --short`, then commit only the sync service, collect screen, check-in routing and focused tests with message `feat(collection): collect scoped invoices from visits`.

## Task 5: Remove obsolete manual collection remnants

**Files:**
- Delete: `src/services/collectPaymentIntent.ts`
- Delete: `tests/collectPaymentIntent.test.ts`
- Modify: `tests/invoiceCollectionTransport.test.mjs`

- [ ] **Step 1: Write the failing source guard**

Use `existsSync` to require the obsolete controller is absent, then inspect the new collect screen and Invoice Collection services only. Require no `partnerId`, `journalId`, legacy generic `payment` queue, or `/payments/create` in that scoped collection surface. Do not ban `/payments/create` repo-wide because sales retain separate behavior.

- [ ] **Step 2: Run RED**

Run `node --test tests/invoiceCollectionTransport.test.mjs`.

Expected: FAIL while the obsolete controller exists or while the collection screen retains the manual route/dependency.

- [ ] **Step 3: Delete only dead manual code**

Remove the controller and its test after confirming `rg` finds no production imports. Do not alter sale-payment handling outside Invoice Collection.

- [ ] **Step 4: Run GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

Run `git status --short`, then stage the deletion and focused guard only. Commit with `refactor(collection): remove manual payment boundary`.

## Task 6: Full verification and PR handoff

**Files:**
- Modify only if verification reveals a narrowly-scoped defect.

- [ ] **Step 1: Run focused regression suite**

Run the Invoice Collection intent, persistence, sync, visit and transport/wiring test files with the repository Node test runner. Expected: PASS.

- [ ] **Step 2: Run project gates**

Run `npm test`, `npm run typecheck`, `git diff --check origin/main...HEAD`, then `git status --short --branch`.

Expected: every command passes and the isolated worktree is clean.

- [ ] **Step 3: Request review and open/update the small frontend PR**

Report the GF #110 dependency, exact test results and remaining pilot gates: physical Android online/offline, kill/restart, response-loss and cash-close/liquidation E2E. Do not merge automatically.

## Task 7: Close auth, cash-close and offline-startup integrity gates

**Files:**
- Modify: `src/services/invoiceCollectionPersistence.ts`
- Modify: `src/services/invoiceCollectionSync.ts`
- Modify: `src/stores/useAuthStore.ts`
- Modify: `src/services/rehydrate.ts`
- Modify: `app/_layout.tsx`
- Modify: `src/services/connectivity.ts` only if required for a nonblocking initial connectivity handoff
- Modify: `app/cashclose.tsx`
- Modify: `app/route-close.tsx`
- Modify: `app/collect/[stopId].tsx`
- Create or modify focused auth, startup, collection-summary, cash-close, route-close and copy tests.

- [ ] **Step 1: Write failing cross-feature regressions**

Add tests for all of these behaviors:

1. A 401 leaves the original encrypted collection UUID intact; same
   employee/company reauthentication transfers it to the new session and
   reconnect replays it. Account switch clears it without transfer.
2. Pending/review collection summaries block liquidation and route close, but
   do not enter the generic queue. Applied intents do not block.
3. Startup with unknown/offline connectivity does not call collection transport
   or await an unresolved connectivity probe/mutation timeout before the app becomes usable; confirmed
   connectivity wakes the existing reconciler.
4. A 401 from foreground **or background reconciliation** persists an explicit
   reauth-required view state with UUID/binding intact, stops the batch, and
   exposes the same sign-in action; same-principal handoff converts it back to
   pending for original-UUID replay.
5. The collection UI exposes and tests exact Spanish labels: Confirmado,
   Pendiente de confirmación, Revisión requerida and Inicia sesión de nuevo.

- [ ] **Step 2: Run RED**

Run the new focused tests. Expected: FAIL because current session rotation
clears collection evidence, close gates ignore its encrypted record, and
rehydration can send while online is only a default assumption.

- [ ] **Step 3: Implement minimal session-safe handoff and status summary**

Keep the existing destructive logout/account-switch behavior. Add a narrowly
scoped, same-principal reauthentication handoff for collection intents only:
the old session can be read while its identity is still available; after the
new authenticated identity is known, copy only validated records when employee
and company match, then delete the old copy. Never migrate across principals or
store plaintext.

Expose a read-only collection status summary from encrypted persistence. Wire
pending/review counts into cash-close and route-close gates without adding a
generic queue item or changing server authority.

- [ ] **Step 4: Implement nonblocking connectivity ordering and exact copy**

Start connectivity observation without awaiting any initial `NetInfo` probe,
and schedule reconciliation off the critical rehydration path only after a
confirmed online state. Preserve the existing singleton reconnect wake. Persist
background 401 as `reauth_required` metadata/status without changing UUID or
binding; same-principal handoff resets it to pending. Update UI copy to the
exact state labels, including an explicit sign-in action for any
`reauth_required` state.

- [ ] **Step 5: Run GREEN and commit**

Run focused tests, full `npm test`, `npm run typecheck`, `git diff --check`,
and inspect `git status`. Commit the minimal cross-feature repair as one or
more atomic commits with no unrelated cleanup.
