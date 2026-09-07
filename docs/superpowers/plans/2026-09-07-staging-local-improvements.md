# Staging local improvements implementation plan

> Execute with superpowers:subagent-driven-development; use bounded implementation and review tasks.

**Goal:** Publish the selected local improvements to the existing staging integration branch and prepare an Android staging artifact.

**Architecture:** Merge current main into staging, preserve environment guards, selectively port customer deactivation and catalog/queue durability without restoring obsolete inventory restrictions. Existing price handling and sales projection remain authoritative.

**Tech Stack:** Expo React Native, TypeScript, Zustand, Node test runner, EAS.

## Tasks
- [x] Reconcile staging config with latest main: app.config.ts, app.json, eas.json and release tests. Run config tests and baseline npm test/typecheck.
- [x] Port deactivation feature files from codex/baja-controlada-cliente; adapt app/stop/[stopId].tsx, app/sync.tsx, src/stores/useSyncStore.ts and src/types/sync.ts. Add failing behavioral tests for terminal versus open review states and server acknowledgement. Complete persistence/refresh and endpoint validation.
- [x] Add catalog durability in src/stores/useProductStore.ts and isolated services/tests, scoped by all logistics identity fields. Add tests for stale fallback, mismatched context rejection, refresh failure retention and bounded recent products. Preserve ProductPicker and sale stock-reference policy and pending price semantics.
- [x] Protect insufficient-stock sale queue roots/dependents during both generic and selective cleanup. Add failing tests, implement, verify retry remains same operation ID, preserve existing physical-review handling.
- [ ] Review scoped diff, run npm test and npm run typecheck, verify staging Expo config, commit/push staging integration and attempt Android EAS staging build. Record build URL or exact blocker; leave main untouched.

## Verification result
- Merged main 3be01d9 into staging base 63dd12f; preserved corporate EAS ownership and staging environment guards.
- Full suite: 845 tests passed, zero failures. Typecheck passed. Additional targeted rerun verifies stale inventory responses release their own loading state.
- Staging backend GET /current_database returned HTTP 500 during preflight; live request and sync QA is pending.
- EAS project access verified for @grupofrio/kold-field. The .staging Android app has no configured signing credentials or prior builds in this project.
- Android build not started: external source upload needs explicit authorization in this execution environment. No APK or device QA claimed.

## Remaining staging QA
Restore staging backend identity response, confirm customer-deactivation endpoints match the preserved legacy contract, generate staging APK with its own signing identity, then test deactivation queue/ack/rejection, offline catalog reload, stock-rejected retry and physical-review retention on device. Keep production promotion separate.
