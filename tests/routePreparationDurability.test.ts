import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessRoutePreparationReceipt,
  buildRoutePreparationReceipt,
  parseRoutePreparationReceipt,
  receiptMatchesBinding,
  receiptToStoreSnapshot,
} from '../src/services/routePreparationReceipt.ts';

const baseContext = {
  companyId: 34,
  employeeId: 501,
  operationalDate: '2026-08-19',
  nowMs: Date.parse('2026-08-19T15:00:00.000Z'),
  currentPlanId: 123,
  bundleEtag: '"etag-abc"',
  bundleCanStartRoute: true,
  hasPlan: true,
  stopsCount: 4,
  productCount: 12,
};

function sampleReceipt(overrides: Partial<Parameters<typeof buildRoutePreparationReceipt>[0]> = {}) {
  return buildRoutePreparationReceipt({
    companyId: 34,
    employeeId: 501,
    planId: 123,
    operationalDate: '2026-08-19',
    bundleEtag: '"etag-abc"',
    preparedAtMs: Date.parse('2026-08-19T08:30:00.000Z'),
    customersTotal: 4,
    customersPrepared: 4,
    pricesPrepared: 48,
    failures: [],
    ...overrides,
  });
}

test('A) same plan receipt survives process restart simulation', () => {
  const receipt = sampleReceipt();
  const assessment = assessRoutePreparationReceipt(receipt, baseContext);
  assert.equal(assessment.status, 'prepared');
  if (assessment.status !== 'prepared') return;
  assert.equal(receiptToStoreSnapshot(assessment.receipt).preparedPlanId, 123);
});

test('B) navigation away/back keeps prepared state in memory (receipt unchanged)', () => {
  const receipt = sampleReceipt();
  const roundTrip = parseRoutePreparationReceipt(JSON.parse(JSON.stringify(receipt)));
  assert.deepEqual(roundTrip, receipt);
  assert.equal(receiptMatchesBinding(receipt, baseContext), true);
});

test('C) same-principal session rotation keeps receipt when binding still matches', () => {
  const receipt = sampleReceipt();
  assert.equal(receiptMatchesBinding(receipt, baseContext), true);
});

test('D) same plan refresh keeps receipt when bundle etag unchanged', () => {
  const receipt = sampleReceipt();
  assert.equal(
    receiptMatchesBinding(receipt, { ...baseContext, nowMs: baseContext.nowMs + 60_000 }),
    true,
  );
});

test('E) new plan invalidates preparation receipt', () => {
  const receipt = sampleReceipt({ planId: 123 });
  assert.equal(
    receiptMatchesBinding(receipt, { ...baseContext, currentPlanId: 124 }),
    false,
  );
  const assessment = assessRoutePreparationReceipt(receipt, {
    ...baseContext,
    currentPlanId: 124,
  });
  assert.equal(assessment.status, 'invalid_receipt');
});

test('F) expired bundle keeps readable preparation but blocks actions', () => {
  const receipt = sampleReceipt();
  const assessment = assessRoutePreparationReceipt(receipt, {
    ...baseContext,
    bundleCanStartRoute: false,
  });
  assert.equal(assessment.status, 'prepared_bundle_expired');
});

test('new operational day invalidates prior preparation', () => {
  const receipt = sampleReceipt({ operationalDate: '2026-08-18' });
  assert.equal(receiptMatchesBinding(receipt, baseContext), false);
});

test('different employee cannot inherit preparation', () => {
  const receipt = sampleReceipt({ employeeId: 777 });
  assert.equal(receiptMatchesBinding(receipt, baseContext), false);
});

test('different company cannot inherit preparation', () => {
  const receipt = sampleReceipt({ companyId: 99 });
  assert.equal(receiptMatchesBinding(receipt, baseContext), false);
});

test('corrupt preparation receipt fails closed', () => {
  assert.equal(parseRoutePreparationReceipt({ version: 2 }), null);
  assert.equal(parseRoutePreparationReceipt({ version: 1, planId: 'x' }), null);
  assert.equal(assessRoutePreparationReceipt({ bad: true }, baseContext).status, 'unprepared');
});

test('bundle etag drift invalidates stale receipt', () => {
  const receipt = sampleReceipt({ bundleEtag: '"etag-old"' });
  assert.equal(
    receiptMatchesBinding(receipt, { ...baseContext, bundleEtag: '"etag-new"' }),
    false,
  );
});

test('missing cached plan/products invalidates receipt on hydrate', () => {
  const receipt = sampleReceipt();
  assert.equal(receiptMatchesBinding(receipt, { ...baseContext, productCount: 0 }), false);
  assert.equal(receiptMatchesBinding(receipt, { ...baseContext, hasPlan: false, stopsCount: 0 }), false);
});

test('failed refresh does not require destroying prior receipt artifact itself', () => {
  const receipt = sampleReceipt();
  const stillValid = assessRoutePreparationReceipt(receipt, baseContext);
  assert.equal(stillValid.status, 'prepared');
});
