# INV-1B — Ambiguous acknowledgement reconciliation

Status: implemented on app branch `cursor/koldfield-inv1b-ambiguous-ack-7494`

## Protocol

```
ambiguous ledger op (sale_order | gift)
  → reconcile by OPERATION IDENTITY
      sale:  POST …/sales/check_duplicate  (operation_id only; NO created_at_ms)
      gift:  idempotent replay of gift/create
  → if COMMITTED: durable _serverAcknowledgedAtMs + mark done
  → fetch NEW truck_stock  (snapshotAtMs >= ackAt)
  → keep-set drops op only when snapshotAtMs >= ackAt
  → projectInventory → applySellableProjection
```

Fail-safe:

- reconcile timeout / network → leave unacked → keep local movement
- snapshot fetch fails after ACK → keep local movement until a later successful post-ack snapshot
- never use qty heuristics

## Authority

| Source | Used? |
|---|---|
| operation_id / idempotency_key | YES |
| server_stock == expected | NO |
| created_at window on check_duplicate | NO (omitted) |

## Matrix

| SYNC TYPE | LEDGER | BACKEND IDEMPOTENT | RECONCILE PATH |
|---|---|---|---|
| sale_order | yes | sales/create by operation_id | check_duplicate (status) |
| gift | yes | saleops idempotency_key | replay create |
| exchange | online ledger adapters | saleops | not in sync queue today |
| payment | no | payments/create | n/a |

## Files

- `src/services/ambiguousAckReconcile.ts`
- `src/services/ambiguousAckReconcileRuntime.ts`
- `src/services/inventoryLedger.ts` (ack-aware keep)
- `src/stores/useProductStore.ts` (reconcile → snapshot → rebase)
- `src/stores/useSyncStore.ts` (markDone stamps ack)
- `src/services/gfLogistics.ts` (`checkSaleDuplicate`)
