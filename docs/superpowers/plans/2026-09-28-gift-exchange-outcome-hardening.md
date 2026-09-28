# Gift and exchange outcome hardening implementation plan

Production contract evidence:
`C:/Users/Hp/.codex/evidence/production-kold-contract-20260928/report.md`
(read-only; backend SHA `79983ae144bf0cfe3e65f2839dea0643ceb21383`).

1. Add failing contract tests for valid success, functional rejection, busy, and
   malformed HTTP 200 responses for both operations.
2. Add failing queue-policy tests for retry identity, terminal rejection, and
   preserving ambiguous operations after automatic retry exhaustion.
3. Implement the shared outcome parser and classifier without React Native
   dependencies.
   Require exact audited success identities without requiring `ok:true`.
   Require a stable idempotency key for both flows before POST and strip local
   queue metadata so retries preserve the same wire payload.
4. Wire gift and exchange services, direct screens, queue processing, and
   reconciliation to the shared classification.
5. Add source-wiring regressions covering pending versus confirmed/rejected
   ticket and inventory paths.
6. Run focused tests, typecheck, and the full suite; document the pre-existing
   unrelated baseline failure separately on build 8 and PR HEAD. Do not report
   the complete suite as green while it remains.
7. Review the diff, commit, push, and open a draft PR with contract evidence,
   validation, the separate exchange-stock gap, and build/deployment limits.

E2E remains pending because staging build `38698037` lacks backend PR #268.
