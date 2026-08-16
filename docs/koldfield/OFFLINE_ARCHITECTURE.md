# Kold Field — Offline Architecture (as implemented / in flight)

## Canonical path (PR #73 + POST-R1A)

```
Bearer login
→ GET /gf/logistics/api/employee/day-bundle (ETag)
→ validate schema day_bundle.v1
→ encrypted session persistence
→ atomic store hydration
→ screens / queue
→ inventory ledger (encrypted) for stock-affecting ops
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

## Catalog vs truck inventory vs ledger

`catalog[]` / truck stock is the **server snapshot baseline**.

POST-R1A inventory ledger:
- append-only movements (`sale`, `gift`, `exchange_*`, …)
- sellable display is a **projection** (`projectInventory`) — exact math, no clamp
- encrypted record key: `inventory-ledger`
- offline sale/gift: `sync:queue` + `inventory-ledger` in **one** envelope put
  (`updateEncryptedRecords` / `commitSyncQueueAndLedger`)
- see `INVENTORY_LEDGER.md`

`updateLocalStock` remains only for legacy / non-`_ledgerApplied` queue items.
Migrated call sites (A1): sale · gift · exchange.

## Directory / Venta Especial

`plan.offroute_directory` defaults **True**; plaza scope is the security boundary.
See `ADR-offroute-directory-authorization.md`.

## Queue

Mutable ops carry UUID v4 `operation_id`, persist across crash/restart, and reconcile
ambiguous timeouts by replaying the same id (never minting a second op).
Idempotency persistence failures roll back the commercial effect (fail-loud).
Ledger-applied ops also set `_ledgerApplied` so dead-letter rollback reverses via ledger.

## Remaining gaps

- Load / refill baseline as first-class `initial_load` / `refill` movements (POST-R1B)
- Consignment offline (POST-R1C)
- Mi Día (POST-R1E)
- Pilot: dual-PG concurrency, credential rotation, signed builds, device E2E
