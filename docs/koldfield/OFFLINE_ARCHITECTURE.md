# Kold Field — Offline Architecture (as implemented / in flight)

## Canonical path (PR #73)

```
Bearer login
→ GET /gf/logistics/api/employee/day-bundle (ETag)
→ validate schema day_bundle.v1
→ encrypted session persistence
→ atomic store hydration
→ screens / queue
```

## Offline lease

- Bundle with future `expires_at` → `fresh` (can start route + mutate)
- Expired / wrong employee/date → `stale` (readable orientation only; mutations blocked)
- Network unavailable after a fresh download does **not** by itself revoke the lease
- Security revocation / session invalid remain hard stops

## Queue

Mutable ops carry UUID v4 `operation_id`, persist across crash/restart, and reconcile
ambiguous timeouts by replaying the same id (never minting a second op).

## Remaining gaps

- Full inventory ledger buckets
- Consignment offline enqueue parity
- Plaza directory incremental paging for large plazas
