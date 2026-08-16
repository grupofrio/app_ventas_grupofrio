# INV-1B — Ambiguous acknowledgement reconciliation

Status: implemented on app branch `cursor/koldfield-inv1b-ambiguous-ack-7494`

## Protocol

```
ambiguous ledger op (sale_order | gift)
  → reconcile by OPERATION IDENTITY (network only → ACK intents)
      sale:  POST …/sales/check_duplicate
             authority = operation_id (NO created_at_ms / time-window heuristic);
             partner_id / stop_id / plan_id remain for tenancy/ownership scope
      gift:  idempotent replay of the SAME gift/create payload (no new operation_id)
  → if COMMITTED: ackAt = nowMs() AFTER confirmation
  → applyServerAcknowledgementsDurably(intents) via queuePersistence.transformAndPersist
      read latest queue → mutate ONLY matching item_id+operation_id+type
      → durable write → then publish memory
  → fetch NEW truck_stock  (snapshotAtMs is a client ordering fence ≥ ackAt;
     NOT a server revision token)
  → keep-set drops op only when snapshotAtMs >= ackAt
  → projectInventory → applySellableProjection
```

Fail-safe:

- reconcile timeout / network → leave unacked → keep local movement
- durable ACK persist failure → do NOT publish memory ACK → keep local movement
- snapshot fetch fails after ACK → keep local movement until a later successful post-ack snapshot
- never use qty heuristics
- never whole-replace the queue from a stale pre-network snapshot

Durable ACK note: `selectPersistableQueue` omits `status === 'done'`. After a successful
serialized ACK apply, the durable `sync:queue` no longer contains that row (same as
`markDone` + persist). The durable effect is “no longer ambiguous”; in-memory still
holds `done` + `_serverAcknowledgedAtMs` until restart. After restart the op is absent
from the queue and the keep-set will not retain its ledger movement once a post-ACK
`truck_stock` rebase runs (client fence: snapshot request starts only after durable ACK).

## Concurrent writers

Single-flight only coalesces concurrent reconcile flights. ACK apply uses the existing
serialized persistence coordinator so concurrent `enqueue` / `processQueue` /
status mutations on unrelated items are preserved.

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
- `src/stores/useProductStore.ts` (reconcile → durable ACK → snapshot → rebase)
- `src/stores/useSyncStore.ts` (`applyServerAcknowledgementsDurably`, markDone stamps ack)
- `src/services/gfLogistics.ts` (`checkSaleDuplicate`)
- `tests/ambiguousAckReconcile.test.ts`
- `tests/ambiguousAckDurableApply.test.ts`
