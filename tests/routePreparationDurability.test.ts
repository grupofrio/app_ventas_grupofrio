import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessRoutePreparationReceipt,
  buildRoutePreparationReceipt,
  parseRoutePreparationReceipt,
  receiptMatchesBinding,
  receiptToStoreSnapshot,
} from '../src/services/routePreparationReceipt.ts';

const bundleOperationalDate = '2026-08-19';

const baseContext = {
  companyId: 34,
  employeeId: 501,
  operationalDate: bundleOperationalDate,
  nowMs: Date.parse('2026-08-19T15:00:00.000Z'),
  currentPlanId: 123,
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
    operationalDate: bundleOperationalDate,
    bundleEtag: '"etag-old"',
    preparedAtMs: Date.parse('2026-08-19T08:30:00.000Z'),
    customersTotal: 4,
    customersPrepared: 4,
    pricesPrepared: 48,
    failures: [],
    ...overrides,
  });
}

test('A) harmless bundle refresh with new ETag keeps route PREPARED', () => {
  const receipt = sampleReceipt({ bundleEtag: '"etag-old"' });
  assert.equal(
    receiptMatchesBinding(receipt, { ...baseContext }),
    true,
  );
  const assessment = assessRoutePreparationReceipt(receipt, baseContext);
  assert.equal(assessment.status, 'prepared');
});

test('G) restart after harmless ETag change still hydrates prepared', () => {
  const receipt = sampleReceipt({ bundleEtag: '"etag-before-refresh"' });
  const roundTrip = parseRoutePreparationReceipt(JSON.parse(JSON.stringify(receipt)));
  assert.ok(roundTrip);
  const assessment = assessRoutePreparationReceipt(roundTrip, baseContext);
  assert.equal(assessment.status, 'prepared');
  assert.equal(receiptToStoreSnapshot(assessment.receipt).preparedPlanId, 123);
});

test('B) new plan_id invalidates preparation', () => {
  const receipt = sampleReceipt({ planId: 123 });
  assert.equal(receiptMatchesBinding(receipt, { ...baseContext, currentPlanId: 124 }), false);
  assert.equal(
    assessRoutePreparationReceipt(receipt, { ...baseContext, currentPlanId: 124 }).status,
    'invalid_receipt',
  );
});

test('C) different employee/company invalidates preparation', () => {
  assert.equal(receiptMatchesBinding(sampleReceipt({ employeeId: 777 }), baseContext), false);
  assert.equal(receiptMatchesBinding(sampleReceipt({ companyId: 99 }), baseContext), false);
});

test('D) new operational day invalidates preparation', () => {
  const receipt = sampleReceipt({ operationalDate: '2026-08-18' });
  assert.equal(receiptMatchesBinding(receipt, baseContext), false);
});

test('E) bundle actually expired keeps orientation but blocks actions', () => {
  const assessment = assessRoutePreparationReceipt(sampleReceipt(), {
    ...baseContext,
    bundleCanStartRoute: false,
  });
  assert.equal(assessment.status, 'prepared_bundle_expired');
});

test('F) mid-route bundle content change (new ETag) does NOT turn route unprepared', () => {
  const receipt = sampleReceipt({ bundleEtag: '"etag-before-sale"' });
  assert.equal(
    assessRoutePreparationReceipt(receipt, {
      ...baseContext,
      nowMs: baseContext.nowMs + 4 * 60 * 60_000,
    }).status,
    'prepared',
  );
});

test('device local date rollover does not invalidate while bundle operational day matches', () => {
  const receipt = sampleReceipt({ operationalDate: '2026-08-19' });
  assert.equal(
    receiptMatchesBinding(receipt, {
      ...baseContext,
      operationalDate: '2026-08-19',
      nowMs: Date.parse('2026-08-20T01:00:00.000Z'),
    }),
    true,
  );
});

test('corrupt preparation receipt fails closed', () => {
  assert.equal(parseRoutePreparationReceipt({ version: 2 }), null);
  assert.equal(parseRoutePreparationReceipt({ version: 1, planId: 'x' }), null);
  assert.equal(assessRoutePreparationReceipt({ bad: true }, baseContext).status, 'unprepared');
});

test('missing cached plan/products invalidates receipt on hydrate', () => {
  const receipt = sampleReceipt();
  assert.equal(receiptMatchesBinding(receipt, { ...baseContext, productCount: 0 }), false);
  assert.equal(receiptMatchesBinding(receipt, { ...baseContext, hasPlan: false, stopsCount: 0 }), false);
});

test('failed refresh does not require destroying prior receipt artifact itself', () => {
  assert.equal(assessRoutePreparationReceipt(sampleReceipt(), baseContext).status, 'prepared');
});

test('bundleEtag remains stored as diagnostic metadata', () => {
  const receipt = sampleReceipt({ bundleEtag: '"etag-diagnostic"' });
  assert.equal(receipt.bundleEtag, '"etag-diagnostic"');
});
