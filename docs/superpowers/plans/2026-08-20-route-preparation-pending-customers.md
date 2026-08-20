# Route Preparation Pending Customers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the names and reasons for customer-price preload failures in route preparation.

**Architecture:** A pure helper resolves a failure name from its live failure record or the already-downloaded route stops. `RoutePreparationCard` consumes that helper to render existing state only.

**Tech Stack:** TypeScript, React Native, Node built-in test runner.

---

### Task 1: Resolve safe display names

**Files:**
- Modify: `src/services/routePreparationLogic.ts`
- Modify: `tests/routePreparationLogic.test.ts`

- [ ] Write a failing test for a live failure name, a route-stop fallback, and `Cliente #<id>`.
- [ ] Run `node --test --experimental-strip-types tests/routePreparationLogic.test.ts` and observe RED.
- [ ] Add the smallest pure `describePreparationFailure` helper.
- [ ] Re-run the focused test and observe GREEN.

### Task 2: Render existing failures in the card

**Files:**
- Modify: `src/components/domain/RoutePreparationCard.tsx`
- Modify: `tests/startDayFlowWiring.test.mjs`

- [ ] Write a failing source-wiring assertion requiring the helper and visible pending names/reasons.
- [ ] Run `node tests/startDayFlowWiring.test.mjs` and observe RED.
- [ ] Render the bounded list before the existing retry control, with no data fetch.
- [ ] Re-run the wiring test, `npm run typecheck`, `npm test`, and `git diff --check`.
- [ ] Commit atomically after `git status --short` review.
