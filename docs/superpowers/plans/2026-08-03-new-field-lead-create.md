# Standalone Field Lead Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create independent field leads in Odoo from Kold Field without requiring a route stop or creating a customer automatically.

**Architecture:** Add `lead/create` to `gf_logistics_ops`. It derives company and plaza from the authenticated employee, stores a per-company operation UUID on `crm.lead`, resolves input channel codes to `channel_id`, and returns the existing lead for duplicate UUIDs. The app preserves its offline queue, canonicalizes the data and routes only `_source: nuevo_lead_ruta` to the new endpoint.

**Tech Stack:** Odoo 18/Python, PostgreSQL constraints, TypeScript, React Native/Expo, Zustand, Node 22 tests.

**Design spec:** `docs/superpowers/specs/2026-08-03-new-field-lead-create-design.md`

---

## File map

### Backend (`/Users/sebis/Documents/odoo/GrupoFrio`)

- Create `gf_logistics_ops/models/crm_lead.py`: operation UUID plus per-company unique constraint.
- Modify `gf_logistics_ops/models/__init__.py`: load CRM model extension.
- Modify `gf_logistics_ops/__manifest__.py`: declare `gf_prospector`, owner of `crm.lead.channel_id`.
- Modify `gf_logistics_ops/controllers/gf_api.py`: endpoint, validation, stage/channel resolution, idempotent response.
- Modify `gf_logistics_ops/tests/test_fasttrack_api.py`: transaction-level contract tests.

### App (`/Users/sebis/Desktop/app-ventas-v2`)

- Modify `src/services/leadIntake.ts`: canonical API keys and current Industria channel.
- Modify `src/services/gfLogistics.ts`: `createFieldLeadData` and operation ID mapping.
- Modify `src/stores/useSyncStore.ts`: source-specific endpoint dispatch.
- Modify `app/newcustomer.tsx`: accurate queued-save copy.
- Modify `tests/leadIntake.test.ts`, `tests/leadEndpoints.test.ts`, and `tests/newCustomerGiroWiring.test.mjs`.

### Worktrees

- App: `/Users/sebis/Desktop/app-ventas-v2/.worktrees/new-lead-create` (`codex/new-lead-create`).
- Backend: create `/Users/sebis/Documents/odoo/GrupoFrio/.worktrees/new-field-lead-create` (`codex/new-field-lead-create`). Never write in the dirty primary checkout.

## Task 1: Persist the field-lead operation UUID

**Files:**

- Create: `gf_logistics_ops/models/crm_lead.py`
- Modify: `gf_logistics_ops/models/__init__.py`
- Modify: `gf_logistics_ops/__manifest__.py`
- Test: `gf_logistics_ops/tests/test_fasttrack_api.py`

- [ ] **Step 1: Write failing model tests**

Add tests that `crm.lead` exposes both `gf_field_operation_id` and `channel_id`, normal records may leave the UUID unset, and two field leads in one company cannot persist the same non-empty UUID. Add a manifest-contract assertion that `gf_logistics_ops` depends on `gf_prospector`, which owns `crm.lead.channel_id`.

- [ ] **Step 2: Verify RED**

Run:

```bash
python3 -m pytest gf_logistics_ops/tests/test_fasttrack_api.py -k field_lead
```

Expected: fail because the field does not exist.

- [ ] **Step 3: Implement the minimal model extension**

Declare `gf_prospector` in the manifest dependency list. Define `gf_field_operation_id = fields.Char(index=True, copy=False, size=120)` on `_inherit = 'crm.lead'`, import it, and add `unique(company_id, gf_field_operation_id)`. Persist no empty string: ordinary leads must remain unaffected. The endpoint will use a database savepoint around creation so this constraint also protects concurrent requests.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test; then:

```bash
git add gf_logistics_ops/__manifest__.py gf_logistics_ops/models/crm_lead.py gf_logistics_ops/models/__init__.py gf_logistics_ops/tests/test_fasttrack_api.py
git commit -m "feat: persist field lead operation ids"
```

## Task 2: Implement the standalone Odoo endpoint

**Files:**

- Modify: `gf_logistics_ops/controllers/gf_api.py`
- Modify: `gf_logistics_ops/tests/test_fasttrack_api.py`

- [ ] **Step 1: Write failing endpoint tests**

Using `_employee_customer_scope_fixture()` and `_patch_request()`, call `_handle_field_lead_create` without `stop_id` using a payload with `operation_id`, `customer_name`, `contact_name`, `phone`, `mobile`, `street`, `description`, GPS, and `x_canal: 'INDUSTRIAL'`. Assert exactly one `crm.lead` is created; assert type `lead`, employee company, explicit `x_analytic_un_id`, initial stage, `channel_id.code == 'DISTRIBUIDOR'`, and exact contact/address/description/GPS values. Assert no partner or route stop creation. Repeat the UUID and assert the same ID plus `duplicate=True`. Add an HTTP route test that sends the token through the request headers and verifies the route uses the session-employee wrapper, rejecting a missing token.

Add a second valid request for `x_canal: 'EVENTOS'` and assert it resolves to `CENTROS_CONSUMO`, as confirmed for Eventos / Banquetes.

Add negative tests for missing operation ID/blank name/unknown non-empty channel (`validation_error`), missing analytic plaza (`scope_not_configured`), cross-company employee/request (`access_denied`), and no eligible stage (`configuration_error`). Each must be `ok=False`, include the exact code and leave no record behind. Add a conflict-path test that simulates an `IntegrityError` from create, verifies the savepoint exits cleanly, and returns the pre-existing UUID record.

- [ ] **Step 2: Verify RED**

Run:

```bash
python3 -m pytest gf_logistics_ops/tests/test_fasttrack_api.py -k field_lead_create
```

Expected: fail because the handler and route do not exist.

- [ ] **Step 3: Add focused helpers**

Add `_initial_lead_stage(company)`, `_find_field_lead_by_operation(company, operation_id)`, `_field_lead_channel(payload_data)`, and `_serialize_field_lead_result(lead)`. Channel resolution must call `gf.sales.channel._get_channel_from_value(value, strict=True)` and only write `channel_id`, never legacy `x_canal`. Normalize the app-only input `EVENTOS` to `CENTROS_CONSUMO` before strict lookup.

- [ ] **Step 4: Add idempotent creation and route**

Implement a small coded exception (`FieldLeadCreateError(code, message)`) and have `_safe` map it to `_response(False, message, code=code)` before generic Odoo exceptions; do not change codes for existing endpoints. `_handle_field_lead_create` validates non-empty `operation_id`/`customer_name`, reuses mobile company/plaza checks, returns an existing UUID before create, chooses the first global/company stage by `sequence, id`, and creates only a lead with all contract fields (`contact_name`, `phone`, `mobile`, `street`, `description`, GPS, company, plaza and `channel_id`). Wrap `Lead.create` in `with request.env.cr.savepoint():`; on `IntegrityError`, let the savepoint roll back, then re-read the UUID and return it with `duplicate=True`. Add `/gf/logistics/api/employee/lead/create` with the session employee wrapper.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
python3 -m pytest gf_logistics_ops/tests/test_fasttrack_api.py -k field_lead_create
python3 -m py_compile gf_logistics_ops/models/crm_lead.py gf_logistics_ops/controllers/gf_api.py
git add gf_logistics_ops/controllers/gf_api.py gf_logistics_ops/tests/test_fasttrack_api.py
git commit -m "feat: create standalone mobile field leads"
```

Expected: all tests pass.

## Task 3: Canonicalize the app payload

**Files:**

- Modify: `src/services/leadIntake.ts`
- Modify: `tests/leadIntake.test.ts`

- [ ] **Step 1: Write failing tests**

Require `buildProspectionPayload` to include `customer_name`, `phone`, and `mobile` with the soft-normalized number. Require Giro Industria to produce `x_canal === 'DISTRIBUIDOR'` and Giro Eventos to produce `x_canal === 'CENTROS_CONSUMO'`; retain existing readable description and empty-phone behavior. Assert their user-visible channel hints follow those mappings.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types tests/leadIntake.test.ts
```

Expected: fail because the canonical keys and channel are absent.

- [ ] **Step 3: Implement minimally**

Set Industria to `DISTRIBUIDOR` and Eventos to `CENTROS_CONSUMO`. Populate `customer_name` from the trimmed name and both `phone`/`mobile` from the normalized optional phone. Do not remove legacy keys yet.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test; then:

```bash
git add src/services/leadIntake.ts tests/leadIntake.test.ts
git commit -m "fix: canonicalize field lead payload"
```

## Task 4: Dispatch independent leads to `lead/create`

**Files:**

- Modify: `src/services/gfLogistics.ts`
- Modify: `src/stores/useSyncStore.ts`
- Modify: `tests/leadEndpoints.test.ts`

- [ ] **Step 1: Write failing routing tests**

Require `createFieldLeadData` to post to `${GF_BASE}/lead/create`, copy a non-empty `_operationId` to `operation_id` without mutating the queued payload, and require the prospection dispatcher to use it only for `_source === 'nuevo_lead_ruta'`. All other prospections must remain on `upsertLeadData`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/leadEndpoints.test.ts
```

Expected: fail because service and dispatch branch are missing.

- [ ] **Step 3: Implement endpoint-specific service and branch**

Clone only the existing response-parsing pattern into `createFieldLeadData`. It validates `_operationId`, sends `{ ...payload, operation_id }` without `_operationId`, and passes metadata unchanged. The dispatcher must branch on the exact source; post-visit behavior remains untouched.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test; then:

```bash
git add src/services/gfLogistics.ts src/stores/useSyncStore.ts tests/leadEndpoints.test.ts
git commit -m "feat: route independent leads to dedicated endpoint"
```

## Task 5: Make the user confirmation accurate

**Files:**

- Modify: `app/newcustomer.tsx`
- Modify: `tests/newCustomerGiroWiring.test.mjs`

- [ ] **Step 1: Write failing copy test**

Require the success alert title/body to say `Lead guardado localmente` and `pendiente de sincronización`, and reject the former unqualified success title.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/newCustomerGiroWiring.test.mjs
```

Expected: fail because the form claims remote success.

- [ ] **Step 3: Change only the alert copy**

Keep enqueue and navigation untouched. Explain that Odoo will receive the lead once synchronization succeeds.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test; then:

```bash
git add app/newcustomer.tsx tests/newCustomerGiroWiring.test.mjs
git commit -m "fix: clarify pending field lead synchronization"
```

## Task 6: Full verification and deployment order

**Files:** Verify all files above.

- [ ] **Step 1: Run the app checks**

```bash
npm run typecheck
npm test
```

- [ ] **Step 2: Run backend regression tests**

```bash
python3 -m pytest gf_logistics_ops/tests/test_fasttrack_api.py
```

For the configured Odoo runtime, run `odoo-bin -c odoo.conf -u gf_logistics_ops --test-enable --test-tags gf_logistics_ops --stop-after-init` before deployment.

- [ ] **Step 3: Inspect and hand off**

Run `git status --short` and `git log --oneline --max-count=5` in each worktree. Deploy/upgrade `gf_logistics_ops` first, smoke-test one authenticated `lead/create` call in staging, then distribute the app build.
