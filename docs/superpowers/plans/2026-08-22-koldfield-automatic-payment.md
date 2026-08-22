# Kold Field Automatic Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Kold Field sale derive its payment method from the server-authorized customer policy, without a driver-selected payment field.

**Architecture:** The day bundle remains a display-only source for the app's payment label and warning. The Bearer sales endpoint recalculates the canonical partner policy after resolving the scoped stop, persists the derived payment method and a review marker, and never accepts payment or invoice decisions from a mobile payload.

**Tech Stack:** React Native/Expo, TypeScript, Zustand, encrypted field store, Odoo 18 Python controllers/models, Odoo tests, Node test runner.

---

### Task 0: Establish an executable baseline

**Files:**
- Verify only: `/Users/sebis/Desktop/app-ventas-v2/.worktrees/koldfield-auto-payment-app`
- Verify only: `/Users/sebis/Documents/gf/.worktrees/koldfield-auto-payment-gf`

- [ ] **Step 1: Run the mobile baseline suite**

Run: `npm test`

Expected: record all pre-existing failures before product changes. Current baseline has three failures on `origin/main`: `routeStartAuthoritativeWiring` and two Android Metro-bundle tests. Do not modify them in this feature branch.

- [ ] **Step 2: Run focused source checks for existing sales contracts**

Run: `node --test tests/saleConfirmFeedback.test.mjs tests/visitState.test.ts`

Expected: PASS before edits.

### Task 1: Derive and expose mobile sale payment presentation

**Files:**
- Create: `src/services/koldfieldSalePaymentPolicy.ts`
- Modify: `app/sale/[stopId].tsx`
- Modify: `src/stores/useVisitStore.ts`
- Modify: `src/services/visitState.ts`
- Test: `tests/koldfieldSalePaymentPolicy.test.ts`
- Test: `tests/saleConfirmFeedback.test.mjs`
- Test: `tests/visitState.test.ts`

- [ ] **Step 1: Write failing policy tests**

Cover exact pure mappings: `cash_only → cash/Contado`, `credit_allowed → credit/Crédito`, `blocked → credit/Crédito · revisar`, unknown/missing mode → cash/Contado · revisar. Include a policy warning case (invalid credit metric) that preserves the mapped method and does not throw.

- [ ] **Step 2: Run the focused test red**

Run: `node --test --experimental-strip-types tests/koldfieldSalePaymentPolicy.test.ts`

Expected: FAIL because the policy presenter does not exist.

- [ ] **Step 3: Implement the minimal pure presenter**

The presenter receives only validated day-bundle policy data and returns `{ method, label, reviewRequired }`. It must not perform network I/O, mutate the bundle, or manufacture numeric credit values.

- [ ] **Step 4: Run focused tests green**

Run: `node --test --experimental-strip-types tests/koldfieldSalePaymentPolicy.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing screen/store wiring tests**

Assert that the sale screen no longer renders Efectivo/Crédito choice buttons, does not require `salePaymentMethod` to enable confirmation, and does not include `payment_method` or `create_invoice` in its sale payload. Assert the displayed label comes from the pure presenter.

- [ ] **Step 6: Run the wiring tests red**

Run: `node --test tests/saleConfirmFeedback.test.mjs`

Expected: FAIL because the legacy selector and client-authoritative payload remain.

- [ ] **Step 7: Implement minimal app wiring**

Remove mutable `salePaymentMethod` and `setSalePayment` from visit state. Replace the selector with a read-only policy badge. Build ticket/recovery display from the presenter only; preserve the existing stable operation ID and offline sales flow.

- [ ] **Step 8: Verify app wiring green**

Run: `node --test tests/saleConfirmFeedback.test.mjs && node --test --experimental-strip-types tests/visitState.test.ts tests/koldfieldSalePaymentPolicy.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the mobile-only presentation change**

Run: `git status --short && git add app/sale/[stopId].tsx src/stores/useVisitStore.ts src/services/visitState.ts src/services/koldfieldSalePaymentPolicy.ts tests/koldfieldSalePaymentPolicy.test.ts tests/saleConfirmFeedback.test.mjs tests/visitState.test.ts && git commit -m "refactor(sale): derive payment display from customer policy"`

### Task 2: Make the Bearer sales endpoint the payment authority

**Files:**
- Modify: `gf_logistics_ops/services/koldfield_bundle.py`
- Modify: `gf_logistics_ops/controllers/gf_api.py`
- Modify or create: `gf_logistics_ops/models/sale_order.py`
- Test: `gf_logistics_ops/tests/test_koldfield_payment_policy.py`
- Test: `gf_logistics_ops/tests/test_employee_api_authorization_matrix.py`

- [ ] **Step 1: Write failing backend tests**

Create a scoped-stop Bearer sale test for each policy mode. Assert the server derives `cash`, `credit`, and `credit + review marker` respectively, with no caller method dependency. Add a negative test proving `payment_method`, all aliases, and `create_invoice` in a Kold Field sales payload produce a deterministic 422 before side effects.

- [ ] **Step 2: Execute red test**

Run the smallest existing Odoo test command for the new test class. If local Odoo runtime is unavailable, run source-contract coverage and record the runtime test for CI; do not claim it passed locally.

Expected: FAIL because `_handle_sales_create` currently reads `_payload_sale_payment_method()` and `create_invoice` from the client.

- [ ] **Step 3: Extract a canonical server policy resolver**

Move the partner mode mapping into a shared, server-only resolver used by both the day-bundle serializer and sale creation. Do not infer from payment-term names. Return the derived method and a review reason for `blocked`/unknown configuration.

- [ ] **Step 4: Remove client payment authority**

After scoped partner/stop resolution, use only the shared resolver. Remove mobile `payment_method` and `create_invoice` interpretation from the Kold Field route. Add an explicit persisted review field/reason only if the target `sale.order` model provides a stable namespaced field; never overload user-entered notes.

- [ ] **Step 5: Run backend focused tests green**

Run the same command as Step 2 plus the employee authorization matrix.

Expected: PASS; a replay with the same UUID returns its stored sale/result without recalculating a conflicting client-supplied method.

- [ ] **Step 6: Commit the backend authority change**

Run: `git status --short && git add gf_logistics_ops/services/koldfield_bundle.py gf_logistics_ops/controllers/gf_api.py gf_logistics_ops/models/sale_order.py gf_logistics_ops/tests/test_koldfield_payment_policy.py gf_logistics_ops/tests/test_employee_api_authorization_matrix.py && git commit -m "fix(sale): derive Kold payment from customer policy"`

### Task 3: Integrate authoritative results into mobile receipts and recovery

**Files:**
- Modify: `app/sale/[stopId].tsx`
- Modify: `src/services/saleTicket.ts`
- Modify: `src/services/saleRecoveryIntent.ts`
- Test: `tests/saleRecoveryIntent.test.ts`
- Test: `tests/saleTicket.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Assert that a queued/offline sale retains no caller-selected method, while a confirmed server response updates ticket/recovery display to the server value and preserves a review flag. Assert no cash accounting is fabricated before a server result.

- [ ] **Step 2: Run red**

Run: `node --test --experimental-strip-types tests/saleRecoveryIntent.test.ts tests/saleTicket.test.ts`

Expected: FAIL because the recovery snapshot currently captures the driver-selected method.

- [ ] **Step 3: Implement minimal reconciliation wiring**

Keep only a provisional display classification in pending state. Persist the server-authoritative method/review signal once received, retaining existing durable UUID/ledger/queue behavior unchanged.

- [ ] **Step 4: Run focused tests green**

Run: `node --test --experimental-strip-types tests/saleRecoveryIntent.test.ts tests/saleTicket.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit receipt/recovery integration**

Run: `git status --short && git add app/sale/[stopId].tsx src/services/saleTicket.ts src/services/saleRecoveryIntent.ts tests/saleRecoveryIntent.test.ts tests/saleTicket.test.ts && git commit -m "fix(sale): reconcile derived payment results"`

### Task 4: Verify and hand off

**Files:**
- Verify only: all changed files

- [ ] **Step 1: Run type and focused validation**

Run: `npm run typecheck` and every focused mobile command from Tasks 1 and 3.

Expected: PASS.

- [ ] **Step 2: Run full mobile suite and record baseline delta**

Run: `npm test`

Expected: no new failures. The three Task 0 baseline failures must remain the only failures unless independently fixed in a separate authorized change.

- [ ] **Step 3: Run backend validation and CI-ready checks**

Run: targeted Odoo tests where runtime is available, `python3 -m compileall` for changed addons, and `git diff --check` in both worktrees.

Expected: PASS or explicit local-runtime limitation documented; GitHub Actions is required before merge.

- [ ] **Step 4: Review status and create separate PRs**

Backend PR first, rebased on GF `origin/main`; mobile PR second, rebased after the backend PR merges. Do not merge either automatically.
