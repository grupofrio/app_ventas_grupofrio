# Paste-ready PR bodies (agent cannot edit non-agent-managed descriptions)

**Human action required before approval:** paste the blocks below into GitHub PR descriptions.

## gf #73

```
## Kold Field R0/R1 — Backend (gf) PR #73

Tip SHA: 51270c6bad37e3ac3848d91990641cde667dfc3d
Branch: codex/koldfield-r0-r1 (contains origin/main)
Module: gf_logistics_ops 18.0.1.13.0
pytest (local source contracts): 223 passed

### CI tip 51270c6b — required checks completed/success
- write-inventory-drift 31915576442
- gf_saleops CI (static) 31915576443
- gf_pwa_admin-odoo-ci 31915576461
  jobs: stub-hygiene, policy-pure, odoo-tests, odoo-tests-saleops SUCCESS

odoo-tests-saleops (Fase 0 + R0/R1 TransactionCases):
tags: gf_no_sale_checkout, gf_no_sale_control_center, gf_koldfield_bundle, gf_koldfield_idempotency, kf_day_bundle
Result @ tip 51270c6b: 0 failed, 0 error(s) of 39 tests

### Full-tip Odoo.sh (Option B)
Host staging10082026 · branch koldfield-r01-fulltip · HEAD 51270c6b
gf_logistics_ops 18.0.1.13.0 · offroute migration applied (0 False / 602)
Smokes GREEN: offroute / payment / HTTP day-bundle / idempotency
Details in gf docs/koldfield/STAGING_GATE_R01.md

CONCURRENCY_RUNTIME_PENDING = PILOT HARDENING GATE
Credential: ROTATION REQUIRED (pilot blocker)

Merge backend before frontend app #73. No auto-merge. No Inventory Ledger in this PR.
```

## app_ventas_grupofrio #73

```
## Kold Field R0/R1 — Frontend PR #73

Tip SHA: dfd796ba924065ed0d100c5e1f633848ab0daccb
Branch: codex/koldfield-r0-r1 (contains origin/main)
npm test: 552 passed · typecheck pass · git diff --check clean
No GitHub Actions workflows in this repo — reproducible local gates only.

Security guard (tests/noPrivilegedOdooClient + sweep on tip):
- no privileged Odoo client in src
- no operational odooRpc import
- no call_kw /web/dataset in src
- no admin API key path
UUID v4 field ops · encrypted day-bundle persistence · crash/retry recovery · offroute · payment contract · exchange inventory
salePaymentMethod retained (not removed in this phase).

Depends on backend gf #73 tip 51270c6b (day-bundle / employee APIs / logistics 18.0.1.13.0).
Backend full-tip staging smokes GREEN on that SHA.

Merge after backend gf #73 is on main. No auto-merge.
```
