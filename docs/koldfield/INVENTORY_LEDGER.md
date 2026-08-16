# Inventory Ledger — Kold Field

Status: **POST-R1A in progress** (frontend local/offline projection).  
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
| `sellable` | Units available to sell/gift/deliver from the van |
| `physical` | Derived: sum of van-held buckets (sellable + return_good + damaged + pending) |
| `consigned` | At customer under consignment |
| `return_good` | Good returns awaiting CEDIS handling |
| `damaged` | Damaged / merma awaiting CEDIS |
| `pending` | In-flight / unknown separation |

`physical` is a **projection**, not an independently mutated store.

### Movement

```
movement_id          UUID v4 (unique per movement row)
operation_id         Same UUID as commercial op when applicable
movement_type        see below
product_id
quantity             > 0
uom                  optional string/code
bucket_from          bucket | null (null = outside/system)
bucket_to            bucket | null (null = outside/customer/CEDIS)
stop_id / partner_id / plan_id / employee_id
created_at           ISO
sync_status          pending | processing | synced | retryable_error | review_required | rejected | reversed
server_reference     optional
metadata             non-secret bag
```

Retries **reuse** `operation_id`. Never mint a new commercial id on retry.

### Movement types (schema-ready; A1 activates a subset)

`initial_load` · `refill` · `sale` · `gift` · `consignment_out` · `consignment_return` ·  
`exchange_delivery` · `exchange_return_good` · `exchange_return_damaged` ·  
`return_good` · `return_damaged` · `adjustment` · `reversal`

## Semantics (FROM → TO)

| Op | Movements | Sellable | Notes |
|---|---|---|---|
| Sale | sellable → null | −N | Not merma |
| Gift | sellable → null | −N | Not automatic scrap (ADR gift) |
| Exchange delivery | sellable → null | −N | |
| Exchange return good | null → return_good | 0 | |
| Exchange return damaged | null → damaged | 0 | **Never** +sellable |
| Consignment out | sellable → consigned | −N | Prepared, not full UI in A1 |
| Consignment return | consigned → sellable | +N | |
| Refill accepted | null → sellable | +N | POST-R1B |
| Reversal | compensating opposite | restores | Append-only; never delete original |

## Projection

```ts
projectInventory({ initialSnapshot, movements })
→ per product_id: { sellable, consigned, return_good, damaged, pending, physical }
```

Rules:

- Apply movements in stable order: `created_at`, then `movement_id`
- Duplicate `movement_id` → ignored (idempotent projection)
- `reversal` references original via metadata / paired type; still append-only
- `null` unknown ≠ `0`

## Snapshot vs ledger

- `snapshot` = last accepted server baseline (load / truck stock / day-bundle catalog)
- `movements` = local journal **after** `snapshot_at` / `snapshot_version`
- On new server snapshot: replace snapshot; drop movements already confirmed for ops in that snapshot; keep pending local ops

## Atomic local write (P0)

One barrier:

1. build movements for `operation_id`
2. append to ledger record
3. persist encrypted ledger
4. project → update sellable display store
5. only then confirm UI / continue queue path

If persist fails → **do not** confirm the operation visually.

## Compatibility with R0/R1

- Consumes existing UUID v4 `operation_id` / idempotency contract
- Encrypted session store (`inventory-ledger` record) — no plaintext parallel
- `_localStockDelta` retained temporarily for sync-queue rollback until rollback speaks ledger reversals; **must not double-apply** with a second `updateLocalStock` path when ledger already applied

## Migration (local)

Upgrade path:

1. If no ledger envelope: create snapshot from current `qty_display` (sellable) + empty movements
2. Do **not** silently wipe prior cache
3. Document removal of direct `updateLocalStock` callers once adapters cover them

## Rollback / feature safety

- A1 feature path is additive domain + adapters
- If ledger apply throws, screens must fail closed (same as lock persist failure on sale)
- No old-store + new-ledger dual mutation on migrated call sites

## Out of scope (A1)

Full consignment UI · Mi Día · payment UX rewrite · backend stock schema · dual-PG · signed builds

## Next

POST-R1B Load/Refill/Returns using `initial_load` / `refill` / return types.
