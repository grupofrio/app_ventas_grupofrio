# Gift and exchange outcome hardening

## Context

The frontend base is `b43c521f3bd9a8ff5c844c12d2a7771691ad11c8`
(`main`, KOLD Field 1.4.2 build 8). At investigation time `origin/main`
resolved to the same SHA. The backend evidence comes from `gf` `origin/main`
`79983ae144bf0cfe3e65f2839dea0643ceb21383`; backend PR #268 is commit
`9c78a342d66630064a569d386ce85b06b4ae6bb8` and is an ancestor of that SHA.

KOLD Field 1.4.2 build 8 points both mutations at the deployed `gf_saleops` routes:

- `POST /gf/salesops/gift/create`
- `POST /gf/salesops/exchange/create`

The deployed backend returns successful mutations as `{ user_message, data }`.
Mobile authorization and validation failures use `{ ok: false, code, status?, message }`.
The shared idempotency service can also return the older
`{ status: "error" | "busy", code, user_message, data }` envelope. Lock
contention currently uses `ok:false`, code `LOCK_BUSY`.

The build 8 client only checks `ok:false` in the generic transport. Its gift and
exchange normalizers therefore accept old error envelopes and malformed HTTP 200
responses as success.

## Design

Add one React Native independent result validator for both mutations. A response
is confirmed only when its operation identity is present:

- gift: a positive `sale_order_id` (current contract) or positive legacy
  `gift_id`, plus a non-empty operation name and state;
- exchange: a positive `exchange_id`, non-empty `exchange_name`, and state.

The validator raises a typed error for:

- functional rejection: `ok:false` or `status:"error"` with a definitive code;
- busy: `LOCK_BUSY`, `LOCKED`, or `status:"busy"`;
- ambiguous result: malformed success, transport failure, or server outcome whose
  commit state cannot be proven.

Direct submission uses that classification. Definitive rejection shows the
backend message and creates neither ticket nor ledger movement. Busy and
ambiguous results enqueue the exact original payload and operation id, produce a
pending ticket, and keep the optimistic ledger movement.

Queue processing marks an item `done` only after strict validation. Definitive
rejection becomes terminal and rolls back its ledger movement. Busy or ambiguous
results retry with the same queue id. When their automatic retry budget is
exhausted, they remain in `error` at the retry limit with no next retry, so the
existing reconciliation pass can replay the same idempotency key. They are not
marked `dead` and their ledger movement is not reversed.

## Boundaries

This change does not alter warehouse receiving, IVA, return modes, backend
records, endpoints, or payload fields. It does not add client-side exchange stock
enforcement; that remains a separate gap even though the current backend rejects
insufficient delivery stock.

Open frontend PR #110 only changes guarded fixture tooling. Draft PR #109 targets
the staging branch and shares `gfLogistics.ts` for lead/off-route work, but it does
not modify the exchange function or either sales-ops outcome contract.
