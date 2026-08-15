# Kold Field — Production / Pilot Readiness

## Status: READY_FOR_REVIEW (not READY_FOR_PILOT / not READY_FOR_PRODUCTION)

### Gate checklist

| Gate | Estado |
|---|---|
| No commits directos a main | OK |
| app PR #73 | closure pass tip |
| npm test | 552 pass |
| tsc | pass |
| `git diff --check` | pass |
| salePaymentMethod UI | **kept** until backend policy enforcement is universal |
| Credential rotation | **ROTATION REQUIRED** |

### Closure notes

- Offline lease soft-dates across device midnight until `expires_at`
- Payment policy accepts `credit_over_limit`; rejects unpublished `credit_only`
- Schema hash pinned in `employeeDayBundleLogic.test.ts`
