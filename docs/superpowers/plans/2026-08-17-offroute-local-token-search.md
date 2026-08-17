# Off-route local token search — implementation plan

> Execute from `/Users/sebis/Desktop/app-ventas-v2/.worktrees/offroute-local-token-search` on `codex/offroute-local-token-search`.

1. Add a pure failing test for normalized all-token matching of day-bundle directory entries, plus a wiring assertion that `searchOffrouteEntities()` invokes it.
2. Add the smallest pure matcher/helper in the off-route search logic; keep the service restricted to the current encrypted day bundle.
3. Run the focused test, full `npm test`, `npm run typecheck`, and `git diff --check`.
4. Inspect status and commit the implementation atomically.
5. Request an adversarial review before opening a PR.
