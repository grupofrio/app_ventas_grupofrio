# Kold Field — Production / Pilot Readiness

## Status: READY_FOR_REVIEW (not READY_FOR_PRODUCTION)

### Gate checklist

| Gate | Estado |
|---|---|
| No commits directos a main | OK |
| app PR #73 tip pushed | OK `b7f2665` |
| gf PR #73 tip pushed | OK `bd4e6569` |
| npm test | 551 pass |
| tsc | pass |
| day bundle contract script | pass |
| compileall | pass |
| GitHub Actions gf | **CI_INFRASTRUCTURE_BLOCKED** (billing) |
| Staging Odoo upgrade 18.0.1.12.0 | PENDING |
| Credential rotation | **ROTATION REQUIRED** |
| Field pilot 2–3 sellers | PENDING |

### Residual blockers before pilot

1. Human merge of both PR #73 after review
2. Credential rotation on server
3. Staging ContractCase / HTTP smoke with real Odoo
4. Remaining product gaps: consignación cash/online, sale payment selector, returns acuse, load reject, inventory ledger
