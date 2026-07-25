# Odoo Sales List Seller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the authoritative seller name to every KoldField sales-list row so tickets reopened from Ventas do not fall back to “Vendedor no especificado”.

**Architecture:** Keep seller resolution inside `sale.order`, next to the existing KoldField sales serializer. Resolve the employee from the sale marker first, then the optional generic employee field, then the route-plan salesperson and driver. Expose only the resulting name through the existing `/sales/list` response; do not accept seller identity from the mobile client.

**Tech Stack:** Odoo ORM, Python, `gf_logistics_ops`, Odoo `TransactionCase`/HTTP handler tests.

**Repository:** `/Users/sebis/Documents/odoo/GrupoFrio`

**Delivery order:** Merge and deploy this additive backend response before releasing the KoldField frontend when practical. The old app ignores the additional field safely.

---

## Preparation: isolate the dirty backend checkout

The primary backend checkout is intentionally not the implementation surface:
it currently contains an unrelated local commit, is behind its remote branch,
and has an untracked `ayuda.py`. Preserve all of that state.

- [ ] Fetch the authoritative backend branch:

```bash
git -C /Users/sebis/Documents/odoo/GrupoFrio fetch origin GrupoFrio
```

- [ ] Create the isolated worktree and feature branch:

```bash
git -C /Users/sebis/Documents/odoo/GrupoFrio worktree add \
  -b codex/odoo-ticket-seller \
  /Users/sebis/Documents/odoo/GrupoFrio/.worktrees/odoo-ticket-seller \
  origin/GrupoFrio
```

- [ ] Run every remaining backend command from:

```text
/Users/sebis/Documents/odoo/GrupoFrio/.worktrees/odoo-ticket-seller
```

- [ ] Confirm the isolated worktree is clean and the primary checkout still
contains its original unrelated state.

The repository does not contain Odoo core or a local `odoo-bin`, and no CI
workflow in this checkout provisions a disposable Odoo database. Therefore,
the backend plan has a hard runtime checkpoint:

- implementation and structural checks may be prepared on the isolated branch;
- the branch may be pushed only as explicitly unverified/draft work for the
  collaborator;
- Task 2 must not be marked GREEN, and the branch must not be merged or
  deployed, until an authorized disposable Odoo/Odoo.sh runner is identified;
- before running the Odoo commands below, replace every
  `<disposable_test_db>` with the exact non-production database name and record
  the runner, addons path, database creation/cleanup procedure, and command
  output;
- production is never an acceptable test database.

If no authorized runner is available at execution time, stop the backend plan
at the runtime checkpoint and report that precise blocker. `py_compile` and
diff checks remain useful local gates but never substitute for Odoo runtime
tests.

---

## File map

- Modify `gf_logistics_ops/models/sale_order.py`: resolve the authoritative seller and serialize `employee_name`.
- Modify `gf_logistics_ops/tests/test_fasttrack_api.py`: prove the API field and every fallback level.
- No controller change: `_handle_sales_list()` already delegates to `get_kold_sales_list()`.
- No manifest, model-field, ACL, or database migration change.

### Task 1: Add failing API and hierarchy regressions

**Files:**
- Modify: `gf_logistics_ops/tests/test_fasttrack_api.py`
- Test: `gf_logistics_ops/tests/test_fasttrack_api.py`

- [ ] **Step 1: Extend the authenticated sales-list test with the missing field**

In `test_handle_sales_summary_and_list_use_authenticated_employee_scope`, add:

```python
for order in listing["data"]["orders"]:
    self.assertEqual(order["employee_name"], self.driver.name)
```

Keep this assertion with the existing partner, stop, state, payment, units, and
line assertions. The sale-creation fixture already persists the authenticated
employee in `x_kold_employee_id`.

- [ ] **Step 2: Add a focused seller-resolution hierarchy test**

Add a test named:

```python
def test_sales_list_seller_prefers_sale_employee_then_route_fallbacks(self):
```

Build one sale through `_handle_sales_create`, browse the returned order, and
assert `_serialize_kold_sales_order(order)["employee_name"]` through these
states:

```python
serialized = self.sale_order_model._serialize_kold_sales_order(order)
self.assertEqual(serialized["employee_name"], self.driver.name)

# Generic employee fallback, only when the optional field exists.
if "employee_id" in order._fields:
    order.write({"x_kold_employee_id": False})
    serialized = self.sale_order_model._serialize_kold_sales_order(order)
    self.assertEqual(serialized["employee_name"], order.employee_id.name)

# Route salesperson fallback.
clear_employee_vals = {"x_kold_employee_id": False}
if "employee_id" in order._fields:
    clear_employee_vals["employee_id"] = False
order.write(clear_employee_vals)
serialized = self.sale_order_model._serialize_kold_sales_order(order)
self.assertEqual(
    serialized["employee_name"],
    order.gf_route_plan_id.salesperson_employee_id.name,
)

# Route driver fallback.
order.gf_route_plan_id.write({"salesperson_employee_id": False})
serialized = self.sale_order_model._serialize_kold_sales_order(order)
self.assertEqual(
    serialized["employee_name"],
    order.gf_route_plan_id.driver_employee_id.name,
)

# No source returns an empty additive field.
order.gf_route_plan_id.write({"driver_employee_id": False})
serialized = self.sale_order_model._serialize_kold_sales_order(order)
self.assertEqual(serialized["employee_name"], "")
```

The test fixture must assert the created order is linked to a route plan before
the fallback mutations. If the shared fixture has no distinct salesperson,
create one and assign it to the plan so the salesperson and driver fallbacks
are independently observable.

- [ ] **Step 3: Runtime checkpoint and targeted RED**

Only after the preparation checkpoint names an authorized disposable Odoo
runner, its database lifecycle, and the GrupoFrio addons path, run:

```bash
odoo-bin -d <disposable_test_db> \
  -u gf_logistics_ops \
  --test-enable \
  --stop-after-init \
  --test-tags '/gf_logistics_ops:TestGFLogisticsOpsFastTrackAPI.test_sales_list_seller_prefers_sale_employee_then_route_fallbacks'
```

Expected: FAIL with missing key `employee_name`. If the runner is unavailable,
do not implement Task 2 and report the blocked runtime checkpoint.

Also run the existing list test:

```bash
odoo-bin -d <disposable_test_db> \
  -u gf_logistics_ops \
  --test-enable \
  --stop-after-init \
  --test-tags '/gf_logistics_ops:TestGFLogisticsOpsFastTrackAPI.test_handle_sales_summary_and_list_use_authenticated_employee_scope'
```

Expected: FAIL with missing key `employee_name`.

- [ ] **Step 4: Run syntax validation**

Run:

```bash
python3 -m py_compile gf_logistics_ops/tests/test_fasttrack_api.py
```

Expected: exit 0. This does not replace the red Odoo test.

- [ ] **Step 5: Commit the red tests**

```bash
git add gf_logistics_ops/tests/test_fasttrack_api.py
git commit -m "test(logistics): require seller in sales list"
```

### Task 2: Resolve and serialize the authoritative seller

**Files:**
- Modify: `gf_logistics_ops/models/sale_order.py`
- Test: `gf_logistics_ops/tests/test_fasttrack_api.py`

- [ ] **Step 1: Add one focused employee resolver**

Immediately before `_serialize_kold_sales_order`, add:

```python
@api.model
def _kold_order_employee(self, order):
    employee = order.x_kold_employee_id
    if not employee and "employee_id" in order._fields:
        employee = order.employee_id
    if employee:
        return employee

    stop = order.gf_route_stop_id or order.x_kold_stop_id
    plan = order.gf_route_plan_id or stop.route_plan_id
    if not plan:
        return self.env["hr.employee"]
    return plan.salesperson_employee_id or plan.driver_employee_id
```

The helper returns an empty `hr.employee` recordset when unresolved. It must not
consult `request.env.user`, the currently authenticated mobile employee, or a
client-provided seller value.

- [ ] **Step 2: Add the response field**

At the start of `_serialize_kold_sales_order`, resolve:

```python
employee = self._kold_order_employee(order)
```

Add to the serialized dictionary:

```python
"employee_name": employee.name or "" if employee else "",
```

Do not change any existing keys, domain filters, ordering, totals, or line
serialization.

- [ ] **Step 3: Run the focused tests and verify GREEN**

Run the two exact Odoo test commands from Task 1 on the same recorded
disposable runner/database setup.

Expected: both PASS.

- [ ] **Step 4: Run the whole FastTrack class**

```bash
odoo-bin -d <disposable_test_db> \
  -u gf_logistics_ops \
  --test-enable \
  --stop-after-init \
  --test-tags '/gf_logistics_ops:TestGFLogisticsOpsFastTrackAPI'
```

Expected: 0 failures and 0 errors.

- [ ] **Step 5: Run local structural checks**

```bash
python3 -m py_compile \
  gf_logistics_ops/models/sale_order.py \
  gf_logistics_ops/tests/test_fasttrack_api.py
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the implementation**

```bash
git add \
  gf_logistics_ops/models/sale_order.py \
  gf_logistics_ops/tests/test_fasttrack_api.py
git commit -m "feat(logistics): expose sales-list seller"
```

### Task 3: Review, publish, and stage deployment

**Files:**
- Review: `gf_logistics_ops/models/sale_order.py`
- Review: `gf_logistics_ops/tests/test_fasttrack_api.py`

- [ ] **Step 1: Review the complete backend diff**

```bash
git diff origin/GrupoFrio...HEAD -- \
  gf_logistics_ops/models/sale_order.py \
  gf_logistics_ops/tests/test_fasttrack_api.py
```

Expected: only the resolver, additive response field, and its tests.

- [ ] **Step 2: Request code review**

Use `superpowers:requesting-code-review`. Resolve every P0/P1 finding and rerun
the focused test plus `py_compile`.

- [ ] **Step 3: Push the backend branch**

```bash
git push -u origin codex/odoo-ticket-seller
```

Expected: the remote branch points to the verified local HEAD.

If runtime verification is still blocked, do not call the branch verified.
Push only when the user explicitly wants the collaborator to inspect draft
work, label it unverified in the handoff, and keep merge/deployment blocked.

- [ ] **Step 4: Run or observe CI**

Require the repository checks covering `gf_logistics_ops`. If CI has an Odoo
database runner, confirm the FastTrack test class is green. Do not claim runtime
approval from `py_compile` alone.

- [ ] **Step 5: Merge/deploy before the app when authorized**

The response is additive, so it can be deployed first without breaking the
current app. Verify one `/sales/list` row in the target environment contains:

```json
{
  "name": "S00042",
  "employee_name": "Nombre del vendedor"
}
```

Do not log customer data or full payloads during this smoke check.
