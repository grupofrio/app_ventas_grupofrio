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

The final comparison also uses the read-only production audit at
`C:/Users/Hp/.codex/evidence/production-kold-contract-20260928/report.md`.
It identifies deployed database build `34980678`, `gf_saleops` version
`18.0.1.41.12`, and the same backend SHA above. The audit did not call either
creation endpoint.

The build 8 client only checks `ok:false` in the generic transport. Its gift and
exchange normalizers therefore accept old error envelopes and malformed HTTP 200
responses as success.

## Design

Add one React Native independent result validator for both mutations. It does
not require `ok:true`, because deployed successes do not return that field. A
response is confirmed only when its deployed identity and state are present:

- gift: positive `sale_order_id` and `picking_id`, non-empty
  `sale_order_name`/`gift_name`, and confirmed state `sale` or `done`;
- exchange: positive `exchange_id`, non-empty `exchange_name`, `state="done"`,
  and a positive delivery and/or merma picking id for each non-empty submitted
  list.

Both request paths require a non-empty `meta.idempotency_key` before posting.
The gift request is projected onto the audited `{meta,data}` contract before
every direct send or replay, removing queue-only ledger fields. Therefore a
retry sends the same key and functional payload. The gift wire contract sends
`partner_id`, optional `visit_line_id`, `lines`, optional notes, and
`validate:true`; it no longer forwards locally-derived analytic or mobile
location fields that production derives from the Bearer session. Exchange keeps
the audited `stop_id`, delivery/merma lists, optional notes, and `validate:true`.

The validator raises a typed error for:

- functional rejection: `ok:false` or `status:"error"` with a definitive code;
- busy: `LOCK_BUSY`, `LOCKED`, or `status:"busy"`;
- ambiguous result: malformed success, transport failure, or server outcome whose
  commit state cannot be proven.

`LOCK_BUSY` is recognized from `ok:false + code` even when neither `status` nor
`retry_after` is present. A coded `SERVER_MISCONFIG` response is definitive even
when its logical status is 500; an uncoded HTTP/transport 500 remains ambiguous.

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

The backend exposes no public operation-status endpoint. An ambiguous result
therefore remains pending; reconciliation can only replay the same key and
payload and accept the validated response returned by idempotency.

## Boundaries

This change does not alter warehouse receiving, IVA, return modes, backend
records, endpoints, or payload fields. It does not add client-side exchange stock
enforcement; that remains a separate gap even though the current backend rejects
insufficient delivery stock.

Open frontend PR #110 only changes guarded fixture tooling. Draft PR #109 targets
the staging branch and shares `gfLogistics.ts` for lead/off-route work, but it does
not modify the exchange function or either sales-ops outcome contract.

None of the three current Staging environments contains backend PR #268 plus
authorized fixtures, so none can support end-to-end accreditation of these
flows. E2E remains pending while a Development environment with synthetic
fixtures is evaluated. Creating that environment or generating its build is not
authorized yet. Production mutations are prohibited.

## Validation evidence

`npm run typecheck` passes. The focused gift/exchange contract, queue,
reconciliation, ticket, and inventory regressions pass.

The complete `npm test` command is not green. It stops in batch 10 at
`tests/saleCreateContractWiring.test.mjs` with:

```text
AssertionError [ERR_ASSERTION]: createSale source block must remain directly before acceptRouteLoad
```

Running `node tests/saleCreateContractWiring.test.mjs` reproduces the exact same
failure on the untouched build 8 base
`b43c521f3bd9a8ff5c844c12d2a7771691ad11c8` and on this PR. That test parses
source text and assumes `createSale` is immediately adjacent to
`acceptRouteLoad`; the production code already contains another declaration
between them on build 8. It is documented rather than changed here because it
does not exercise Regalos or Cambios.
