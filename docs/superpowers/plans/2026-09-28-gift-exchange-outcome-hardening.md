# Gift and exchange outcome hardening implementation plan

1. Add failing contract tests for valid success, functional rejection, busy, and
   malformed HTTP 200 responses for both operations.
2. Add failing queue-policy tests for retry identity, terminal rejection, and
   preserving ambiguous operations after automatic retry exhaustion.
3. Implement the shared outcome parser and classifier without React Native
   dependencies.
4. Wire gift and exchange services, direct screens, queue processing, and
   reconciliation to the shared classification.
5. Add source-wiring regressions covering pending versus confirmed/rejected
   ticket and inventory paths.
6. Run focused tests, typecheck, and the full suite; document the pre-existing
   unrelated baseline failure separately.
7. Review the diff, commit, push, and open a draft PR with contract evidence,
   validation, the separate exchange-stock gap, and build/deployment limits.
