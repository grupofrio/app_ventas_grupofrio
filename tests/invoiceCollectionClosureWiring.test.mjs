import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const persistence = readFileSync(resolve('src/services/invoiceCollectionPersistence.ts'), 'utf8');
const cashclose = readFileSync(resolve('app/cashclose.tsx'), 'utf8');
const routeClose = readFileSync(resolve('app/route-close.tsx'), 'utf8');

test('cash close reads the dedicated encrypted summary and passes it to its final gate', () => {
  assert.match(cashclose, /readCurrentInvoiceCollectionSummary/);
  assert.match(cashclose, /invoiceCollectionPendingCount/);
  assert.match(cashclose, /invoiceCollectionReviewCount/);
  assert.match(cashclose, /invoiceCollectionSummaryReady/);
  assert.match(cashclose, /const collectionAfter = await loadInvoiceCollectionSummary\(\)/);
  assert.match(cashclose, /after === 0\s*&& collectionAfter\?\.blockingCount === 0/);
});

test('route close reads the same dedicated summary and passes it to its final gate', () => {
  assert.match(routeClose, /readCurrentInvoiceCollectionSummary/);
  assert.match(routeClose, /invoiceCollectionPendingCount/);
  assert.match(routeClose, /invoiceCollectionReviewCount/);
  assert.match(routeClose, /invoiceCollectionSummaryReady/);
});

test('collection closure summary remains outside the generic queue', () => {
  const summaryBlock = persistence.slice(
    persistence.indexOf('export async function readCurrentInvoiceCollectionSummary'),
  );
  assert.notEqual(summaryBlock, '');
  assert.doesNotMatch(summaryBlock, /useSyncStore|enqueue|sync-queue|sync:queue/);
});
