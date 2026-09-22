# Main Staging Fixes Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the four approved operational fixes from staging into production `main` without importing staging-only configuration.

**Architecture:** Apply the original functional commits in dependency order over current `origin/main`, preserving their regression tests and excluding the staging version assertion. Verify each behavior independently, then verify the combined branch and request a production APK from EAS.

**Tech Stack:** Expo SDK 52, React Native, TypeScript, Zustand, Node test runner, EAS Build.

---

### Task 1: Durable route-start confirmation

**Files:**
- Modify: `src/stores/useRouteStartStore.ts`
- Test: `tests/routeStartPersistence.test.mjs`

- [ ] Restore `tests/routeStartPersistence.test.mjs` from commit `e1c7a63` and run `node --test tests/routeStartPersistence.test.mjs`; expect failure because `storeSave` swallows the encrypted write failure.
- [ ] Remove the temporary test copy, cherry-pick `e1c7a63`, and rerun the test; expect 3 passing tests.
- [ ] Confirm the change only replaces `storeSave` with `storeSaveStrict` for `markRouteStartedForPlan`.

### Task 2: Offline prices by stop pricelist

**Files:**
- Modify: `src/stores/useRoutePreparationStore.ts`
- Test: `tests/routePreparationOfflinePrices.test.mjs`

- [ ] Restore the regression test from `2938d7c` and run it against the current branch; expect missing cached prices for pricelists 81/82.
- [ ] Remove the temporary test copy, cherry-pick `2938d7c`, and rerun the test; expect 2 passing tests.
- [ ] Verify preparation and retry both warm every distinct pricelist used by a partner's stops.

### Task 3: Stable product refresh and route recovery

**Files:**
- Modify: `app/(tabs)/inventory.tsx`
- Modify: `app/exchange/[stopId].tsx`
- Modify: `app/gift/[stopId].tsx`
- Modify: `app/sale/[stopId].tsx`
- Modify: `src/components/domain/RoutePreparationCard.tsx`
- Modify: `src/utils/healthCheck.ts`
- Modify: `src/utils/productLoading.ts`
- Test: `tests/routeReopenRecovery.test.mjs`

- [ ] Restore `tests/routeReopenRecovery.test.mjs` from `aeeec9f` and run it; expect failures because focused refreshes are tied to changing loading state and restored incomplete data can be presented as ready.
- [ ] Remove the temporary test copy and cherry-pick `aeeec9f` without committing.
- [ ] Revert only the staging build-number assertion in `tests/appConfigVariants.test.mjs`, then commit the functional delta using the original commit message.
- [ ] Run `node --test tests/routeReopenRecovery.test.mjs`; expect all route recovery tests to pass.

### Task 4: Mexico City ticket time

**Files:**
- Modify: `src/services/saleTicketFormatting.ts`
- Test: `tests/ticketMexicoTime.test.ts`

- [ ] Restore the regression test from `04578d0` and run it; expect failures for zone-less Odoo dates and Android's obsolete daylight-saving rules.
- [ ] Remove the temporary test copy, cherry-pick `04578d0`, and rerun the test; expect 3 passing tests.
- [ ] Confirm explicit offsets, invalid input, and historical dates retain their intended behavior.

### Task 5: Combined verification

**Files:**
- Verify all modified production and test files.

- [ ] Run `node --test tests/routeStartPersistence.test.mjs tests/routePreparationOfflinePrices.test.mjs tests/routeReopenRecovery.test.mjs tests/ticketMexicoTime.test.ts` and require zero failures.
- [ ] Run `npm run typecheck` and require exit code 0.
- [ ] Run `npm test`; if Windows reports `ENAMETOOLONG`, run the same discovered test files in bounded batches and aggregate the result.
- [ ] Run `git diff --check origin/main...HEAD` and inspect `git diff --stat origin/main...HEAD` to confirm there are no staging-only files.

### Task 6: APK build and handoff

**Files:**
- No source changes expected.

- [ ] Verify Expo authentication with `npx eas-cli@latest whoami`.
- [ ] Start `npx eas-cli@latest build --platform android --profile production-apk --non-interactive` and capture the build URL or the exact authentication/service blocker.
- [ ] Report the branch, commits, test evidence, APK result and the remaining Android device validation steps.
