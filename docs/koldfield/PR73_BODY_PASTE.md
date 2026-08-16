# Paste-ready PR bodies (agent cannot edit non-agent-managed descriptions)

**Human action required before approval:** paste the blocks below into GitHub PR descriptions.

## gf #73

```
## Kold Field R0/R1 — Backend (gf) PR #73

Tip SHA: fafcfac5e2bba6d173181d50a9f3fd708ce8dcf7
Module: gf_logistics_ops 18.0.1.13.0
pytest: 223 passed
CI tip fafcfac5 — all required checks success (incl. odoo-ci-l2)
odoo-tests-saleops: 0 failed, 0 error(s) of 70 tests
Full-tip staging smokes GREEN on runtime ancestor 51270c6b (Option B)
CONCURRENCY_RUNTIME_PENDING = PILOT HARDENING GATE
Credential: ROTATION REQUIRED (pilot blocker)
Merge backend before frontend. No auto-merge.
```

## app_ventas_grupofrio #73

```
## Kold Field R0/R1 — Frontend PR #73

Tip SHA: ef6237827b0f697b305bc60bfec015247450596a
npm test: 552 passed · typecheck pass · git diff --check clean
No GitHub Actions — local reproducible gates only.
Security: no privileged Odoo client / odooRpc / call_kw / web/dataset in src
UUID v4 · encrypted day-bundle · crash/retry · offroute · payment · exchange
Depends on backend gf #73 tip fafcfac5 (18.0.1.13.0).
Merge after backend is on main. No auto-merge.
```
