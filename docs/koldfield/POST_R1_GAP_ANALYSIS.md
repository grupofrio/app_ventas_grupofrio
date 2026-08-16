# Post-R1 Gap Analysis (DELTA)

Baseline: both PR #73 merged into main (2026-08-16).

| Repo | Merge commit | Main at analysis |
|---|---|---|
| `grupofrio/gf` | `1a989539…` | `9d674ea4…` |
| `grupofrio/app_ventas_grupofrio` | `104dfed…` | `104dfed…` |

R0/R1 is **baseline**, not rework.

## Gaps

| Feature | Current state | Backend | Frontend | Risk | Dependency | Classification | Next action |
|---|---|---|---|---|---|---|---|
| Inventory Ledger | Missing; screens mutate `updateLocalStock` | Odoo stock authoritative; no mobile ledger API required for A1 | `useProductStore.updateLocalStock` + `_localStockDelta` | Dual truth; crash mid-mutate; damaged≠sellable only partially | R0/R1 UUID + encrypted store | **P0 OPERATIONAL** · FIX_WITH_NEXT_WORKSTREAM | **POST-R1A** this PR |
| Exchange buckets | Delivery −sellable; damaged not credited (ADR) | Merma location | Still counter mutation, no damaged bucket projection | Incomplete audit trail | Ledger | P0 · FIX_WITH_NEXT | A1 adapters |
| Sale/Gift optimistic stock | Works via delta + rollback | Idempotent ops | Direct `updateLocalStock` | Atomicity op↔stock incomplete | Ledger | P0 · FIX_WITH_NEXT | A1 adapters |
| Load / Refill / Reject | Partial / legacy migration | Pickings | Legacy refill/unload migration | Duplicate stock on retry | Ledger baseline snapshot | **P1 OPERATIONAL** · SEPARATE | POST-R1B |
| Consignment offline | Online-ish; restock calc | Exists | Not full offline enqueue | Overwrites sellable semantics if bolted on counters | Ledger buckets | **P1** · SEPARATE | POST-R1C |
| Payment UX / policy | Policy in day-bundle; `salePaymentMethod` retained | Authority for policy | Method still client-selected | Commercial mis-charge | Ledger not blocking | **P1** · SEPARATE | POST-R1D |
| Mi Día / nav | Not started | N/A | Legacy screens | UX debt | Ledger + ops | **P2 UX** · SEPARATE | POST-R1E |
| Dual-PG concurrency | Pending | Advisory lock only | N/A | Race under dual writers | R0/R1 idempotency | **P0 PILOT BLOCKER** · PILOT_HARDENING | Before pilot |
| Credential rotation | Required | Historical | N/A | Leak | Ops | **P0 PILOT** · PILOT_HARDENING | Before pilot |
| Signed builds / E2E | Missing | N/A | Missing | Ship risk | App store | **P0 PILOT** · PILOT_HARDENING | Before pilot |
| `credit_over_limit` sample | No staging sample | Flags exist | Schema ready | Incomplete smoke | Data | P2 · PILOT_HARDENING | When sample exists |

## Order

1. **POST-R1A** Inventory Ledger Core (this workstream)
2. POST-R1B Load/Refill/Returns
3. POST-R1C Consignment Offline
4. POST-R1D Payment UX
5. POST-R1E Mi Día
6. Pilot hardening register (concurrency, credential, builds, E2E)

## Residuals from #73 incorporated here

| Residual | Classification | Action in A1 |
|---|---|---|
| Need durable local inventory audit trail for offline ops | FIX_WITH_NEXT_WORKSTREAM | Ledger movements tied to `operation_id` |
| Exchange damaged must not return to sellable | Already ADR; complete via buckets | Damaged bucket projection |
| CONCURRENCY_RUNTIME_PENDING | PILOT_HARDENING | Document only |
| Credential rotation | PILOT_HARDENING | Document only |
