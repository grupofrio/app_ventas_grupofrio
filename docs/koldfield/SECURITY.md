# Kold Field — Security

## Current (PR #73)

- Employee `Authorization: Bearer` only for field APIs
- Privileged mobile Odoo client / JSON-RPC / embedded director credentials removed from app tip
- Ranking legacy disabled (do not re-enable without a scoped Bearer endpoint)
- Day bundle and field data encrypted per session

## ROTATION REQUIRED

Historical APKs shipped with an embedded privileged account. Server-side rotation
must invalidate that credential independently of app rollout. Do not paste the
secret into docs, commits, or tickets.

## Google Maps key

Mobile Maps API key may remain in the client binary. Harden with Android package
+ signing SHA (and iOS bundle) restrictions. Document platform restriction status
separately when verifying release builds.

## CI note

gf PR #73 GitHub Actions jobs failed to start due to account billing / spending
limit (`CI_INFRASTRUCTURE_BLOCKED`). Local contract/compile checks remain the
gate until runners are restored.
