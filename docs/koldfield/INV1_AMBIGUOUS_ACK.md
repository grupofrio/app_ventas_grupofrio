# INV-1 — Ambiguous acknowledgement window

Status on app #77: **SUBSTANTIALLY_FIXED / AMBIGUOUS_ACK_RECONCILIATION_PENDING**

## What is fixed

```
visible = truck_stock server snapshot
        + local ledger movements whose sync queue status ∈ {pending, syncing, error}
```

- Synced (`done`) ops are dropped from the journal on rebase → no double-apply after clean ack.
- `dead` ops are not kept; after ledger reversal, next rebase does not resurrect the sale.
- `truck_stock` is no longer an independent mutable display source that ignores the ledger.

## Ambiguous window (still open)

1. Client sends sale with `operation_id = X`
2. Backend **commits** X
3. Response lost / timeout → queue remains `pending` | `syncing` | `error`
4. `truck_stock` refresh **already includes** X
5. Rebase keeps local movement X because queue ≠ done/dead
6. Projection = server(7) − local(3) = **4** instead of **7**

Demonstrated by test:
`AMBIGUOUS ACK GAP: server already includes sale X but queue still pending → double-apply`

## Canonical mechanisms inspected (not invented)

| Mechanism | Exists? | Wired into ledger rebase? |
|---|---|---|
| Backend sales idempotency by `operation_id` | YES | N/A (create path) |
| `/gf/logistics/api/employee/sales/check_duplicate` | YES | **NO** — app does not call it before rebase |
| Payment `x_operation_id` replay | YES | Payment path only |
| Server snapshot revision / included-op list | **NO** | — |

**Decision:** do **not** invent a second ack protocol inside #77. A correct cutover would reuse `check_duplicate` (or equivalent operation lookup) to mark queue `done` **before** rebase when the server already has X — that is a small follow-up workstream, not silent protocol invention here.

## Gate classification

| Question | Answer |
|---|---|
| MERGE_BLOCKER? | **NO** — happy path + pending-not-on-server + done-on-server cases are correct; gap is a race after ambiguous network outcome |
| PILOT_BLOCKER? | **YES** — field network timeouts + inventory refresh can briefly under-show sellable until retry marks `done` or a reconcile step lands |

## Next action

Pre-pilot: before `rebaseAfterTruckStockRefresh`, for each kept `sale_order` op, call existing `sales/check_duplicate` (or sale-by-operation_id lookup). If duplicate exists → mark queue item `done` (no new commercial write) → then rebase. Do not mint server revision tokens.
