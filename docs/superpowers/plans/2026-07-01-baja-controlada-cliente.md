# Baja Controlada De Cliente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el flujo de baja controlada de cliente con solicitud movil, verificacion supervisora, aprobacion/aplicacion corporativa en Odoo y trazabilidad completa sin borrar clientes.

**Architecture:** Odoo sera la fuente de verdad del workflow mediante un modelo nuevo `gf.customer.deactivation.request`, endpoints REST idempotentes y vistas corporativas. KOLD Field agregara captura offline-friendly para vendedor y supervisora, usando la cola existente de `useSyncStore`, fotos persistentes por `localUri` y GPS actual. La aplicacion final de baja actualiza solo flags operativos/comerciales en `res.partner`.

**Tech Stack:** Expo SDK 52, React Native 0.76, expo-router, Zustand, AsyncStorage, TypeScript, node:test, Odoo/GrupoFrio Python models/controllers/security/views.

---

## File Structure

Backend Odoo/GrupoFrio repo, fuera de este workspace:

- Create: `gf_customer_deactivation/__manifest__.py`
- Create: `gf_customer_deactivation/models/customer_deactivation_request.py`
- Create: `gf_customer_deactivation/models/customer_deactivation_evidence.py`
- Create: `gf_customer_deactivation/models/res_partner.py`
- Create: `gf_customer_deactivation/controllers/customer_deactivation_api.py`
- Create: `gf_customer_deactivation/security/customer_deactivation_groups.xml`
- Create: `gf_customer_deactivation/security/ir.model.access.csv`
- Create: `gf_customer_deactivation/security/customer_deactivation_rules.xml`
- Create: `gf_customer_deactivation/views/customer_deactivation_views.xml`
- Modify: `gf_logistics_ops/controllers/gf_api.py` or equivalent stop serializer to expose `deactivation_*` on route stops
- Test: backend Odoo tests under the GrupoFrio test convention

App workspace:

- Create: `src/types/customerDeactivation.ts`
- Create: `src/services/customerDeactivationLogic.ts`
- Create: `src/services/customerDeactivation.ts`
- Modify: `src/types/sync.ts`
- Modify: `src/stores/useSyncStore.ts`
- Modify: `src/types/plan.ts`
- Modify: `src/stores/useRouteStore.ts` if local patch helper needs deactivation-specific updates
- Create: `app/customer-deactivation/[stopId].tsx`
- Modify: `app/stop/[stopId].tsx`
- Create or replace: `app/supervisor-deactivation.tsx` or `app/supervisor.tsx`
- Modify: `app/sync.tsx`
- Modify: `src/services/secondaryFlowCopy.ts`
- Test: `tests/customerDeactivationLogic.test.ts`
- Test: `tests/customerDeactivationSync.test.ts`
- Test: `tests/customerDeactivationFrontendWiring.test.mjs`
- Test: `tests/customerDeactivationSupervisorWiring.test.mjs`

---

### Task 1: Odoo Modelo Base Y Seguridad

**Files:**
- Create: `gf_customer_deactivation/__manifest__.py`
- Create: `gf_customer_deactivation/models/customer_deactivation_request.py`
- Create: `gf_customer_deactivation/models/customer_deactivation_evidence.py`
- Create: `gf_customer_deactivation/models/res_partner.py`
- Create: `gf_customer_deactivation/security/customer_deactivation_groups.xml`
- Create: `gf_customer_deactivation/security/ir.model.access.csv`
- Create: `gf_customer_deactivation/security/customer_deactivation_rules.xml`
- Test: backend Odoo tests for model constraints and ACLs

- [ ] **Step 1: Write failing backend tests for one-open-request constraint**

Test cases:
- Create request for `(company A, partner X)` in open state.
- Creating another open request for same `(company A, partner X)` fails.
- Creating a closed request for same pair is allowed after previous is `rejected` or `applied`.
- Same partner in a different company is isolated.

- [ ] **Step 2: Run backend test and confirm failure**

Run in GrupoFrio/Odoo repo:

```bash
python3 odoo-bin -d <test_db> --test-enable --stop-after-init -i gf_customer_deactivation
```

Expected: FAIL because model/module does not exist.

- [ ] **Step 3: Implement model fields and constraint**

Implement:
- `gf.customer.deactivation.request`
- `gf.customer.deactivation.evidence`
- partner fields `gf_deactivation_state`, `gf_under_deactivation_review`, `gf_operational_status`, `gf_deactivation_request_id`, `gf_deactivation_applied_at`
- SQL or Python constraint for one open request per company/partner

- [ ] **Step 4: Implement groups and record rules**

Groups:
- `group_customer_deactivation_requester`
- `group_customer_deactivation_supervisor`
- `group_customer_deactivation_corporate`
- `group_customer_deactivation_admin`

Rules:
- requester can create/read own company allowed records with limited write.
- supervisor can read/write verification fields for assigned team/company.
- corporate can decide/apply.
- all rules filter by `company_id`.

- [ ] **Step 5: Run backend tests and confirm pass**

- [ ] **Step 6: Commit backend task**

```bash
git add gf_customer_deactivation
git commit -m "feat: add customer deactivation request model"
```

---

### Task 2: Odoo Workflow Transitions

**Files:**
- Modify: `gf_customer_deactivation/models/customer_deactivation_request.py`
- Test: backend Odoo workflow tests

- [ ] **Step 1: Write failing transition tests**

Cover:
- requester can create `reported`/`pending_revisit` only.
- supervisor can verify pending requests.
- corporate can approve/reject/second-visit/recovery/apply.
- invalid transitions raise `UserError`.
- every transition creates log/message with old/new state and comment.

- [ ] **Step 2: Run backend test and confirm failure**

- [ ] **Step 3: Implement transition methods**

Methods:
- `action_submit_request`
- `action_supervisor_verify`
- `action_corporate_decide`
- `action_apply`
- `action_request_second_visit`
- `action_send_commercial_recovery`
- `action_keep_active`

- [ ] **Step 4: Enforce comments where required**

Require comment for:
- rejection.
- second verification.
- commercial recovery.
- keep active.
- apply, if corporate wants final note.

- [ ] **Step 5: Run backend tests and confirm pass**

- [ ] **Step 6: Commit backend task**

```bash
git add gf_customer_deactivation/models
git commit -m "feat: add customer deactivation workflow transitions"
```

---

### Task 3: Odoo REST Endpoints

**Files:**
- Create: `gf_customer_deactivation/controllers/customer_deactivation_api.py`
- Test: backend controller tests

- [ ] **Step 1: Write failing endpoint tests**

Endpoints:
- `POST /gf/logistics/api/employee/customer-deactivation/request`
- `GET /gf/logistics/api/employee/customer-deactivation/open?partner_id=N`
- `GET /gf/logistics/api/supervisor/customer-deactivation/revisits`
- `POST /gf/logistics/api/supervisor/customer-deactivation/<id>/verify`
- `GET /gf/logistics/api/corporate/customer-deactivation/review`
- `POST /gf/logistics/api/corporate/customer-deactivation/<id>/decide`
- `POST /gf/logistics/api/corporate/customer-deactivation/<id>/apply`

- [ ] **Step 2: Confirm tests fail because controllers do not exist**

- [ ] **Step 3: Implement employee request endpoint**

Rules:
- Derive employee/user/company from token where available.
- Validate `company_id` mismatch.
- Validate required fields.
- Decode optional `photo_base64` into `ir.attachment`.
- Apply idempotency via `client_operation_id`.
- Return conflict envelope when an open request already exists for same company/partner.

- [ ] **Step 4: Implement open-status endpoint**

Return:
- `request_id`
- `state`
- `reason`
- `created_at`
- `assigned_supervisor_name`

- [ ] **Step 5: Implement supervisor endpoints**

Rules:
- Only supervisor group.
- Filter by company/team.
- Verification requires photo, GPS, comment and result.
- Idempotent by `client_operation_id`.

- [ ] **Step 6: Implement corporate endpoints**

Rules:
- Only corporate group.
- Decision comments required for non-approve decisions.
- `apply` only allowed after `approved`.

- [ ] **Step 7: Run backend controller tests and confirm pass**

- [ ] **Step 8: Commit backend task**

```bash
git add gf_customer_deactivation/controllers
git commit -m "feat: expose customer deactivation workflow API"
```

---

### Task 4: Odoo Route Serialization And Corporate Views

**Files:**
- Modify: `gf_logistics_ops/controllers/gf_api.py` or equivalent stop serializer
- Create: `gf_customer_deactivation/views/customer_deactivation_views.xml`
- Test: backend route serializer tests

- [ ] **Step 1: Write failing serializer test**

Expected stop payload includes:
- `deactivation_request_id`
- `deactivation_state`
- `deactivation_reason`
- `deactivation_under_review`

- [ ] **Step 2: Implement serializer lookup efficiently**

Batch by partner/company for current route. Do not do one query per stop.

- [ ] **Step 3: Write failing view/action smoke test if backend test framework supports it**

- [ ] **Step 4: Implement Odoo views**

Views:
- list grouped by state.
- form with evidence tabs.
- kanban optional.
- smart button from partner.
- action buttons for corporate decisions.

- [ ] **Step 5: Run backend tests and confirm pass**

- [ ] **Step 6: Commit backend task**

```bash
git add gf_customer_deactivation/views gf_logistics_ops/controllers/gf_api.py
git commit -m "feat: surface customer deactivation status in routes"
```

---

### Task 5: App Types And Validation Helpers

**Files:**
- Create: `src/types/customerDeactivation.ts`
- Create: `src/services/customerDeactivationLogic.ts`
- Modify: `src/types/plan.ts`
- Test: `tests/customerDeactivationLogic.test.ts`

- [ ] **Step 1: Write failing validation tests**

Cases:
- comment required.
- reason required.
- photo required for `not_exists`.
- photo required for `permanently_closed`.
- photo optional for `does_not_want_buy`, `moved`, `duplicate`, `other`.
- valid request builds payload metadata from stop/plan/auth/GPS.
- supervisor verification requires result, comment, GPS and photo.

- [ ] **Step 2: Run test and confirm failure**

```bash
node --experimental-strip-types --test tests/customerDeactivationLogic.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement type definitions**

Include:
- reason/result/decision enums.
- request/verification form types.
- REST response types.
- `GFStop` optional fields in `src/types/plan.ts`.

- [ ] **Step 4: Implement pure validation and payload helpers**

Do not import React Native modules. Keep node-testable.

- [ ] **Step 5: Run test and confirm pass**

- [ ] **Step 6: Commit app task**

```bash
git add src/types/customerDeactivation.ts src/services/customerDeactivationLogic.ts src/types/plan.ts tests/customerDeactivationLogic.test.ts
git commit -m "feat: add customer deactivation validation model"
```

---

### Task 6: App REST Service And Sync Dispatch

**Files:**
- Create: `src/services/customerDeactivation.ts`
- Modify: `src/types/sync.ts`
- Modify: `src/stores/useSyncStore.ts`
- Modify: `app/sync.tsx`
- Modify: `src/services/secondaryFlowCopy.ts`
- Test: `tests/customerDeactivationSync.test.ts`

- [ ] **Step 1: Write failing sync tests**

Cases:
- `SyncItemType` accepts `customer_deactivation_request`.
- `SyncItemType` accepts `customer_deactivation_verification`.
- both are priority 1.
- process dispatcher calls correct REST helper.
- dispatcher reads `localPhotoUri` to base64 only during sync.
- conflict response for existing open request is represented clearly.

- [ ] **Step 2: Run test and confirm failure**

```bash
node --experimental-strip-types --test tests/customerDeactivationSync.test.ts
```

- [ ] **Step 3: Implement REST helpers**

Functions:
- `createCustomerDeactivationRequest(payload)`
- `fetchOpenCustomerDeactivation(partnerId)`
- `fetchSupervisorDeactivationRevisits()`
- `verifyCustomerDeactivation(payload)`

- [ ] **Step 4: Extend sync types and priorities**

Add:
- `customer_deactivation_request`
- `customer_deactivation_verification`

Set both to priority 1.

- [ ] **Step 5: Extend `processSyncItem`**

For each type:
- read photo file via existing camera helper or a new wrapper.
- post REST payload with `photo_base64`.
- handle idempotent success.
- throw clear conflict errors.

- [ ] **Step 6: Update Sync UI labels**

Labels:
- "Solicitud de baja"
- "Verificacion de baja"

- [ ] **Step 7: Run sync tests and targeted existing tests**

```bash
node --experimental-strip-types --test tests/customerDeactivationSync.test.ts
node --experimental-strip-types --test tests/syncDependencies.test.ts
node --experimental-strip-types --test tests/secondaryFlowCopy.test.ts
```

- [ ] **Step 8: Commit app task**

```bash
git add src/services/customerDeactivation.ts src/types/sync.ts src/stores/useSyncStore.ts app/sync.tsx src/services/secondaryFlowCopy.ts tests/customerDeactivationSync.test.ts
git commit -m "feat: sync customer deactivation operations"
```

---

### Task 7: App Vendedor Solicitud Desde Parada

**Files:**
- Create: `app/customer-deactivation/[stopId].tsx`
- Modify: `app/stop/[stopId].tsx`
- Modify: `src/stores/useRouteStore.ts`
- Test: `tests/customerDeactivationFrontendWiring.test.mjs`

- [ ] **Step 1: Write failing frontend wiring tests**

Check:
- stop screen contains "Reportar posible baja".
- stop screen navigates to `/customer-deactivation/[stopId]`.
- request screen imports `takePhoto`, GPS/location store and `useSyncStore.enqueue`.
- request screen enqueues `customer_deactivation_request`.
- request screen does not call `updateStopState(..., 'done')`.

- [ ] **Step 2: Run test and confirm failure**

```bash
node --test tests/customerDeactivationFrontendWiring.test.mjs
```

- [ ] **Step 3: Implement request screen**

UI:
- reason chips.
- required comment.
- optional contact person.
- GPS status.
- photo capture when required.
- submit button.
- offline copy uses "Guardada localmente, se enviara al reconectar".

- [ ] **Step 4: Implement local route patch**

After successful local enqueue/direct submit:
- set `deactivation_under_review=true`.
- set `deactivation_state='pending_revisit'` or backend-returned state.
- do not remove stop.
- do not mark visit done.

- [ ] **Step 5: Add stop entry and badge**

Show button on customer stop. Hide or disable if an open deactivation request exists.

- [ ] **Step 6: Run tests**

```bash
node --test tests/customerDeactivationFrontendWiring.test.mjs
node --experimental-strip-types --test tests/customerDeactivationLogic.test.ts
```

- [ ] **Step 7: Commit app task**

```bash
git add app/customer-deactivation/[stopId].tsx app/stop/[stopId].tsx src/stores/useRouteStore.ts tests/customerDeactivationFrontendWiring.test.mjs
git commit -m "feat: allow sellers to request controlled customer deactivation"
```

---

### Task 8: App Supervisora Revisitas

**Files:**
- Create: `app/supervisor-deactivation.tsx`
- Modify: `app/supervisor.tsx` or profile/home navigation if this becomes the entry point
- Test: `tests/customerDeactivationSupervisorWiring.test.mjs`

- [ ] **Step 1: Write failing supervisor wiring tests**

Check:
- supervisor screen no longer relies only on `MOCK_TEAM` for deactivation flow.
- deactivation revisits screen calls `fetchSupervisorDeactivationRevisits`.
- verification submit enqueues or posts `customer_deactivation_verification`.
- screen gates access with `isSupervisor`.

- [ ] **Step 2: Run test and confirm failure**

```bash
node --test tests/customerDeactivationSupervisorWiring.test.mjs
```

- [ ] **Step 3: Implement supervisor revisits list**

List fields:
- customer name/ref.
- route.
- reason.
- age.
- request comment.
- evidence status.
- state.

- [ ] **Step 4: Implement verification form**

Inputs:
- result.
- comment.
- photo required.
- GPS required or explicit "GPS no disponible" blocked state.

- [ ] **Step 5: Implement offline behavior**

If revisits are already loaded, allow capture offline and enqueue verification. If queue is not loaded and offline, show clear block.

- [ ] **Step 6: Run tests**

```bash
node --test tests/customerDeactivationSupervisorWiring.test.mjs
node --experimental-strip-types --test tests/customerDeactivationLogic.test.ts
```

- [ ] **Step 7: Commit app task**

```bash
git add app/supervisor-deactivation.tsx app/supervisor.tsx tests/customerDeactivationSupervisorWiring.test.mjs
git commit -m "feat: add supervisor customer deactivation revisits"
```

---

### Task 9: End-To-End Hardening

**Files:**
- Modify as needed from previous tasks
- Test: full app test suite and backend test suite

- [ ] **Step 1: Run app targeted tests**

```bash
node --experimental-strip-types --test tests/customerDeactivationLogic.test.ts
node --experimental-strip-types --test tests/customerDeactivationSync.test.ts
node --test tests/customerDeactivationFrontendWiring.test.mjs
node --test tests/customerDeactivationSupervisorWiring.test.mjs
```

- [ ] **Step 2: Run full app tests**

```bash
npm test
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Run backend tests**

```bash
python3 odoo-bin -d <test_db> --test-enable --stop-after-init -i gf_customer_deactivation
```

- [ ] **Step 5: Manual QA script**

Scenarios:
- seller request online with `not_exists` and photo.
- seller request offline, kill app, reopen, reconnect, sync.
- duplicate open request from second device.
- supervisor verification online.
- supervisor verification offline then sync.
- corporate reject.
- corporate second verification.
- corporate approve and apply.
- route still shows client before `applied`.
- historical sale/factura/contact remains accessible after `applied`.

- [ ] **Step 6: Commit hardening fixes**

```bash
git add <changed-files>
git commit -m "test: verify customer deactivation workflow"
```

---

## Rollout Notes

- Deploy backend first, with endpoints and route serialization.
- Release app behind a simple feature flag if backend rollout is not guaranteed on every database.
- Pilot with one company, one supervisor and a small set of test customers.
- Do not set `res.partner.active = false` in the first release.
- Do not remove route stops until corporate validates the operational policy for `applied`.
