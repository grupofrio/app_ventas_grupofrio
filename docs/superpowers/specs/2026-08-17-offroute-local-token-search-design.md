# Off-route local token search — design

## Goal

Make the existing off-route search find customers that are already present in the encrypted day-bundle directory when the seller types several words, changes their order, omits accents, or the terms live across the customer's name, address, and zone.

## Scope

- Search remains entirely local over `bundle.directory` loaded by `loadCurrentEmployeeDayBundle()`.
- The current minimum query length, result DTO, and 20-result limit remain unchanged.
- A match requires every whitespace-delimited query token to occur in the normalized concatenation of the authorized directory entry's name, address, and zone.
- Normalization is case-insensitive, accent-insensitive, and collapses whitespace.

## Non-goals

- No remote lookup, Odoo/RPC fallback, endpoint, authority field, or day-bundle schema change.
- No alteration of off-route visit creation, pricing, customer entitlement, or lead/prospect behavior.
- No search outside the current employee session's day bundle.

## Failure behavior

If no fresh day bundle is available, preserve the current explicit error. A query with an unmatched token returns no results. The matcher never falls back to cached data from another session or another source.

## Verification

Add focused tests for multiword matching, word-order independence, accent normalization, tokens split across name/address/zone, and rejection when any token is absent. Also prove that `searchOffrouteEntities()` invokes the matcher, so a correct helper cannot be bypassed by the service. Keep the existing transport/session and full mobile test suites green.
