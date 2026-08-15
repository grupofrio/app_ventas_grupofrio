# Paste-ready PR bodies (agent cannot edit non-agent-managed descriptions)

**Human action required before approval:** paste the blocks below into GitHub PR descriptions.

## gf #73

```
## Kold Field R0/R1 — Backend (gf) PR #73

Tip SHA: 7ca918306940ecb62a068f6a31377bf631a1c39c
Module: gf_logistics_ops 18.0.1.13.0
pytest: 223 passed (local source contracts)

CI tip 7ca91830 — all completed/success:
- write-inventory-drift 31913109042
- gf_saleops CI (static) 31913108048
- gf_pwa_admin-odoo-ci 31913107966
  jobs: stub-hygiene, policy-pure, odoo-tests, odoo-tests-saleops SUCCESS

odoo-tests-saleops now runs Fase 0 Empresa×Plaza contracts PLUS R0/R1 TransactionCases:
gf_no_sale_checkout, gf_no_sale_control_center, gf_koldfield_bundle, gf_koldfield_idempotency, kf_day_bundle
Evidence in CI log: Starting TestKoldfieldDayBundleDirectoryRuntime / OperationIdempotency / DayBundleHTTP — 0 failed, 0 error(s) of 39 tests.

Staging (honest): surgical overlay of gf_logistics_ops on staging10082026 @ f929c392 → 18.0.1.13.0. Offroute migration 602/602. Offroute / payment / HTTP day-bundle / idempotency service smokes GREEN. NOT full-tip staging. Earlier full tip checkout failed on staging-only divergence; after merging main (#75 Fase 0) tip now includes expense stock_location — full-tip rebuild still recommended separately. Details: docs/koldfield/STAGING_GATE_R01.md

Payment: credit_overdue ≠ credit_over_limit confirmed (TransactionCase + staging overdue sample); no staging sample with credit_over_limit=True (smoke pendiente).
Idempotency: advisory xact lock + replay/conflict/rollback covered in Odoo CI; CONCURRENCY_RUNTIME_PENDING = PILOT HARDENING GATE (not dual-PG).
Credential: ROTATION REQUIRED (pilot blocker).

Merged main into branch to clear CONFLICTING after #75. Merge backend before frontend app #73. No auto-merge. No Inventory Ledger in this PR.
```

## app_ventas_grupofrio #73

```
## Kold Field R0/R1 — Frontend PR #73

Tip SHA: 951ad20132cd1e93fa7299b3ee6da1ada846293e
npm test: 552 passed · typecheck pass
No GitHub Actions workflows in this repo — CI gate is local test + typecheck.

UUID v4 field ops · bundle lease (expires_at) · offroute directory contract · payment policy schema (credit_overdue ≠ over_limit) · exchange sellable stock · no privileged Odoo RPC (odooRpc/call_kw/web/dataset removed from src)
salePaymentMethod retained (not removed in this phase).

Depends on backend gf #73 tip 7ca91830 (day-bundle / employee APIs / logistics 18.0.1.13.0). Staging HTTP smoke validated against upgraded logistics overlay.

Merge after backend gf #73 is on main. No auto-merge.
```
