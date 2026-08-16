# Kold Field — Production / Pilot Readiness

## Status: READY_FOR_REVIEW (POST-R1A Inventory Ledger Core) — NOT READY_FOR_PILOT

R0/R1 (#73) is **merged** on both repos. This document tracks post-R1 workstreams.

### Baseline (#73)
| Repo | Merge commit |
|---|---|
| gf | `1a98953929c455e738b8358d4e9295dee2ae795c` |
| app_ventas_grupofrio | `104dfedcaaf19001bc1926264734ed64cd5f4194` |

### POST-R1A scope
Frontend inventory ledger core (closure): exact projection (no clamp), UUID v5
stable movement identities, encrypted envelope RMW, atomic `sync:queue` +
`inventory-ledger` commit for offline sale/gift, adapters for sale/gift/exchange,
idempotent reversals without counter-mutation fallback.

### Pilot hardening register (not in A1)
| Gate | Classification |
|---|---|
| CONCURRENCY_RUNTIME_PENDING (dual-PG) | **P0 PILOT BLOCKER** |
| Credential rotation / revocation | **P0 PILOT BLOCKER** |
| Signed Android/iOS builds + SHA-256 + artifact scan | **P0 PILOT BLOCKER** |
| Device / staging E2E | **P0 PILOT BLOCKER** |
| `credit_over_limit=True` staging sample | PILOT_HARDENING |

### Next workstreams
POST-R1B Load/Refill/Returns → POST-R1C Consignment → POST-R1D Payment UX → POST-R1E Mi Día

See `POST_R1_GAP_ANALYSIS.md` and `INVENTORY_LEDGER.md`.
