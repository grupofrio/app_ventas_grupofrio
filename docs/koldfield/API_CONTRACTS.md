# Kold Field — API Contracts (day bundle focus)

## Endpoint

`GET /gf/logistics/api/employee/day-bundle`

Auth: employee Bearer session  
Conditional: `If-None-Match` → 304  
Errors: `no_active_plan` 404, `plan_not_found` 404, `ambiguous_active_plan` 409

## Schema

`day_bundle.v1` — artifacts:

- Backend: `gf_logistics_ops/schemas/koldfield/day_bundle.v1.schema.json`
- Frontend: `contracts/koldfield/day_bundle.v1.schema.json` (sha256 drift-checked)

## Notable fields (post R0/R1 fix)

- `stops[].payment_policy` / `directory[].payment_policy`
- `catalog[].stock_qty` may be `0`
- `directory` may include plaza-scoped partners when `offroute_directory`
- `gift_reasons` / `competitors` populated from admin models

## Related mutations

All field mutations require UUID v4 `operation_id` under the PR #73 gate.
