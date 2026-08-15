# Kold Field — Offline Architecture (as implemented / in flight)

## Canonical path (PR #73)

```
Bearer login
→ GET /gf/logistics/api/employee/day-bundle (ETag)
→ validate schema day_bundle.v1
→ encrypted session persistence
→ atomic store hydration
→ screens / queue
```

## Offline lease (`expires_at`)

Backend (`_day_bundle_operational_window`):
- `operational_date` = today in the **company** timezone
- `expires_at` = next **local midnight** in that timezone, serialized as naive UTC

Frontend (`evaluateStoredDayBundle`):
- Lease is governed by `expires_at`, **not** by the device calendar date alone
- `now < expires_at` (or `expires_at` null) → `fresh` (`canStartRoute` + `canRunActions`)
- `now >= expires_at` → `stale` (`canRead` only; mutations blocked)
- Crossing **device** midnight while the lease is still active does **not** strand
  the seller (soft operational-date match on cached reads)
- Crossing **company** midnight (`expires_at`) intentionally ends the day lease;
  the seller must refresh online for the new operational day
- Network loss after a fresh download does **not** by itself revoke the lease
- Security revocation / session invalid remain hard stops

## Catalog vs truck inventory

`catalog[]` is truck inventory (quants ∪ load pickings), including `stock_qty = 0`
for depleted loaded SKUs. Never-loaded authorized products are **excluded** (no
preventa of unloaded SKUs in R0/R1).

## Directory / Venta Especial

`plan.offroute_directory` defaults **True**; plaza scope is the security boundary.

## Queue

Mutable ops carry UUID v4 `operation_id`, persist across crash/restart, and reconcile
ambiguous timeouts by replaying the same id (never minting a second op).

## Remaining gaps (not this PR)

- Full inventory ledger buckets
- Consignment offline enqueue parity
- Plaza directory incremental paging for large plazas
- Returns / Mi Día
