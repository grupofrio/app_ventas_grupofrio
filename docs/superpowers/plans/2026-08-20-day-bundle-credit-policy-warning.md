# Day-bundle Credit Policy Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a valid Kold Field day bundle operational when a finite negative `payment_policy.credit_used` is received, while preserving a typed local warning.

**Architecture:** The strict structural validator remains the only entry point for the encrypted day-bundle record. It will collect an internal `data_quality_warnings` array while traversing stops and directory entries. Only the negative finite `credit_used` case is tolerated; raw server values remain unchanged and all other malformed values still reject atomically. The shared schema will permit signed numeric credit usage so the artifact and runtime policy remain aligned.

**Tech Stack:** TypeScript, Node built-in test runner, Expo/React Native encrypted field-data persistence.

---

### Task 1: Specify and test the narrow warning contract

**Files:**
- Modify: `tests/employeeDayBundleLogic.test.ts`
- Modify: `src/services/employeeDayBundleLogic.ts:11-24`

- [ ] **Step 1: Write the failing test for a negative directory value**

```ts
const accepted = logic.replaceDayBundleAtomically(validRecord({
  bundle: { ...base, directory: [{
    id: 72, name: 'Cliente', payment_term: null,
    payment_policy: validPolicy({ credit_used: -12.5 }),
  }] },
}), context);

assert.equal(accepted.bundle.directory[0].payment_policy.credit_used, -12.5);
assert.deepEqual(accepted.data_quality_warnings, [{
  code: 'negative_credit_used', scope: 'directory', entity_id: 72,
  path: 'directory[0].payment_policy.credit_used',
}]);
assert.equal(logic.evaluateStoredDayBundle(accepted, context).canRunActions, true);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test --experimental-strip-types tests/employeeDayBundleLogic.test.ts`

Expected: FAIL because `credit_used` still invokes `nonNegativeNumber`.

- [ ] **Step 3: Add the minimal typed warning model**

```ts
export interface DayBundleDataQualityWarning {
  code: 'negative_credit_used';
  scope: 'stop' | 'directory';
  entity_id: number;
  path: string;
}

export interface StoredDayBundle {
  // existing fields
  data_quality_warnings: DayBundleDataQualityWarning[];
}
```

Keep this record metadata outside `bundle`, which remains an unmodified
server-owned payload.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test --experimental-strip-types tests/employeeDayBundleLogic.test.ts`

Expected: PASS for the added scenario.

### Task 2: Preserve strict validation for every other value

**Files:**
- Modify: `tests/employeeDayBundleLogic.test.ts`
- Modify: `src/services/employeeDayBundleLogic.ts:180-277`
- Modify: `contracts/koldfield/day_bundle.v1.schema.json`

- [ ] **Step 1: Write failing tests for stop warnings and malformed values**

```ts
assert.deepEqual(accepted.data_quality_warnings, [{
  code: 'negative_credit_used', scope: 'stop', entity_id: 33,
  path: 'stops[0].payment_policy.credit_used',
}]);

for (const creditUsed of [undefined, null, ' -1 ', NaN, Infinity]) {
  assert.throws(() => logic.replaceDayBundleAtomically(...), /credit_used/);
}
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test --experimental-strip-types tests/employeeDayBundleLogic.test.ts`

Expected: FAIL before the validator distinguishes finite negatives from malformed values.

- [ ] **Step 3: Implement the smallest validator split**

Replace only `credit_used` validation with a helper that:

1. rejects non-finite or non-number input;
2. pushes a warning for a finite negative input;
3. otherwise accepts the number unchanged.

Pass the warning collector explicitly into `paymentPolicy`, `validateStops`, and
`validateDirectory`; do not loosen `credit_limit` or `credit_available`.

- [ ] **Step 4: Recompute warnings during record validation**

Do not trust `data_quality_warnings` supplied by a stored record. Ignore any
input metadata and return warnings rebuilt from `bundle` each time
`validateRecord()` runs.

- [ ] **Step 5: Align the contract artifact**

Remove only the `minimum: 0` constraint from `payment_policy.credit_used`,
update its pinned SHA assertion, and retain the minimum constraints for
`credit_limit` and `credit_available`.

- [ ] **Step 6: Run the focused test to verify it passes**

Run: `node --test --experimental-strip-types tests/employeeDayBundleLogic.test.ts`

Expected: PASS; negative values yield warnings and all malformed values still reject.

### Task 3: Regression verification and atomic commit

**Files:**
- Modify: `src/services/employeeDayBundleLogic.ts`
- Modify: `tests/employeeDayBundleLogic.test.ts`

- [ ] **Step 1: Run day-bundle regression tests**

Run: `node --test --experimental-strip-types tests/employeeDayBundleLogic.test.ts tests/employeeDayBundleReauthentication.test.ts && node tests/employeeDayBundleWiring.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run project checks**

Run: `npm test && npm run typecheck && git diff --check`

Expected: PASS.

- [ ] **Step 3: Review and commit**

Run: `git status --short`

Then:

```bash
git add src/services/employeeDayBundleLogic.ts tests/employeeDayBundleLogic.test.ts
git commit -m "fix(bundle): flag negative credit usage"
```

Verify the worktree is clean afterwards. Do not push, merge, or deploy without
separate authorization.
