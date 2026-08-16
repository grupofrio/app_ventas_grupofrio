# Inventory Ledger — Kold Field

Status: **POST-R1A closure** (frontend local/offline projection).
Server (Odoo) remains the **final** stock authority. This ledger is the offline operational journal + projection.

## Why

R0/R1 left inventory as optimistic counter mutations (`updateLocalStock`). That cannot express:

- sellable vs physical vs damaged vs consigned
- append-only audit
- atomic operation + stock + queue persistence
- crash/restart without dual sources of truth

## Model

### Buckets

| Bucket | Meaning |
|---|---|
| `sellable` | Units available to sell/gift/deliver from the van (exact math; may be negative = deficit) |
| `net_van_projection` | Derived: `sellable + return_good + damaged + pending` |
| `consigned` | At customer under consignment (**not** in van) |
| `return_good` | Good returns awaiting CEDIS handling |
| `damaged` | Damaged / merma awaiting CEDIS |
| `pending` | In-flight / unknown separation (counted in van until clarified in later workstreams) |

`net_van_projection` is a **projection**, not an independently mutated store.
It may be negative when `sellable` is in deficit, so it is not asserted as a
physical count. `consigned` is excluded because it is physically at the customer.

### Identities

```
operation_id   UUID v4 — commercial operation (mint once; reuse on retry)
movement_id    UUID v5 — deterministic from operation_id + semantic slot
```

Semantic slot examples:

- `sale:product:123:line:0`
- `gift:product:456:line:0`
- `exchange:delivery:product:10:line:0`
- `exchange:return_damaged:product:10:line:0`
- `reversal:of:{original_movement_id}`

Same logical operation → same movement identity → append/projection dedupe.

### Movement row

```
movement_id, operation_id, movement_type, product_id, quantity, uom,
bucket_from, bucket_to, stop_id, partner_id, plan_id, employee_id,
created_at, sync_status, server_reference, metadata
```

### Movement types (schema-ready; A1 activates a subset)

`initial_load` · `refill` · `sale` · `gift` · `consignment_out` · `consignment_return` ·
`exchange_delivery` · `exchange_return_good` · `exchange_return_damaged` ·
`return_good` · `return_damaged` · `adjustment` · `reversal`

## Semantics (FROM → TO)

| Op | Movements | Sellable | Notes |
|---|---|---|---|
| Sale | sellable → null | −N | Not merma; oversell allowed → deficit |
| Gift | sellable → null | −N | Not automatic scrap (ADR gift) |
| Exchange delivery | sellable → null | −N | |
| Exchange return good | null → return_good | 0 | |
| Exchange return damaged | null → damaged | 0 | **Never** +sellable |
| Consignment out | sellable → consigned | −N | Prepared, not full UI in A1 |
| Consignment return | consigned → sellable | +N | |
| Refill accepted | null → sellable | +N | POST-R1B |
| Reversal | compensating opposite | restores exactly | Append-only; never delete original |

## Projection

```ts
projectInventory({ initialSnapshot, movements })
→ per product_id: {
  sellable, consigned, return_good, damaged, pending,
  net_van_projection, sellable_deficit
}
```

Rules:

- Exact arithmetic — **no silent clamp** to 0
- Oversell: `sellable = -1`, `sellable_deficit = 1`; reversal restores exact baseline
- Apply movements in stable order: `created_at`, then `movement_id`
- Duplicate `movement_id` → ignored (idempotent projection)
- `null` unknown ≠ `0`

## Snapshot vs ledger

- `snapshot` = last accepted server baseline
- `movements` = local journal after `snapshot_at` / `snapshot_version`
- Migration from legacy `qty_display` runs **once** when no ledger exists
- Never remigrate from already-projected `qty_display`

## Atomicity model (POST-R1A closure)

Encrypted session envelope holds both `sync:queue` and `inventory-ledger`.

Primitive: `updateEncryptedRecords(session, mutator)` — single serialized RMW,
one native put. Multiple records updated in the same mutator commit together
or not at all.

| Path | Durable write |
|---|---|
| Online sale/gift/exchange (no new queue row) | ledger RMW only |
| Offline/ambiguous sale, offline/retry gift | `commitSyncQueueAndLedger`: queue + ledger in **one** put |

UI confirmation happens **only after** that put succeeds.
If put fails: neither queue nor ledger changes; in-memory queue is restored.

### Lost-update protection

Ledger append is never load→append→save as separate envelope ops.
All appends run inside `updateRecords` so concurrent sales serialize on the
session envelope and both movements survive.

### Crash cases

| Case | Result |
|---|---|
| Crash before envelope put | no queue row, no movement |
| Crash after put, before HTTP | queue + ledger durable; retry same `operation_id` |
| Backend committed, response lost | retry same `operation_id` (R0/R1 contract) |
| Rollback retry | stable reversal `movement_id`; no double compensation |

## Sync status (A1)

Active in A1 writers: `pending` on new movements; `review_required` signaled on
queue payload (`_ledgerReviewRequired`) when ledger rollback fails.

Deferred to B/C: evolving movement `sync_status` through `processing` /
`synced` / `retryable_error` / `rejected` / `reversed` on server reconciliation.

## Compatibility with R0/R1

- Consumes existing UUID v4 `operation_id` / 409 idempotency contract
- Encrypted session store — no plaintext parallel ledger
- `_localStockDelta` retained on queue payloads for observability / legacy
  non-ledger items; **ledger-applied ops never fall back to `updateLocalStock`**

## Remaining `updateLocalStock` matrix (A1)

| Location | Role | Strategy |
|---|---|---|
| `useProductStore.updateLocalStock` | Legacy API | Keep for out-of-scope ops |
| `useSyncStore` rollback without `_ledgerApplied` | Legacy / non-ledger queue items | Keep until those types migrate |
| `useSyncStore` legacy refill/unload migration | Pre-R1 residue | Out of A1 scope (POST-R1B) |
| sale / gift / exchange screens | Migrated | Ledger only |

## Migration (local)

1. If no ledger: snapshot from current `qty_display` + empty movements (**once**)
2. Do not wipe prior cache
3. After movements exist, never rebuild snapshot from mutated display

## Rollback / feature safety

- Ledger reverse uses stable reversal ids; retry-safe
- Ledger reverse failure → `_ledgerReviewRequired` (no counter fallback)
- Fail closed on persist errors

## Out of scope (A1)

Full consignment UI · Mi Día · payment UX rewrite · backend stock schema · dual-PG · signed builds · Load/Refill

## Next

POST-R1B Load/Refill/Returns using `initial_load` / `refill` / return types.
