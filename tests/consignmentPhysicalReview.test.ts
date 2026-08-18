import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

interface ReviewModule {
  requiresConsignmentPhysicalReview: (item: {
    type: string;
    payload?: Record<string, unknown>;
  }) => boolean;
  isProtectedPhysicalReviewItem: (item: {
    status: string;
    payload?: Record<string, unknown>;
  }) => boolean;
}

test('ledger-backed consignment mutations require human review after terminal rejection', async () => {
  const mod = await import('../src/services/consignmentPhysicalReview.ts') as ReviewModule;
  for (const type of ['consignment_create', 'consignment_visit', 'consignment_close']) {
    assert.equal(mod.requiresConsignmentPhysicalReview({ type, payload: { _ledgerApplied: true } }), true, type);
  }
  assert.equal(mod.requiresConsignmentPhysicalReview({ type: 'sale_order', payload: { _ledgerApplied: true } }), false);
  assert.equal(mod.requiresConsignmentPhysicalReview({ type: 'consignment_create', payload: {} }), false);
});

test('physical consignment review evidence cannot be cleared as generic dead history', async () => {
  const mod = await import('../src/services/consignmentPhysicalReview.ts') as ReviewModule;
  assert.equal(mod.isProtectedPhysicalReviewItem({
    status: 'dead',
    payload: { _consignmentPhysicalDeliveryReviewRequired: true },
  }), true);
  assert.equal(mod.isProtectedPhysicalReviewItem({ status: 'dead', payload: {} }), false);
  assert.equal(mod.isProtectedPhysicalReviewItem({
    status: 'done',
    payload: { _consignmentPhysicalDeliveryReviewRequired: true },
  }), false);
});

test('sync terminal path marks review before any ledger reversal and clearDead retains it', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/stores/useSyncStore.ts'), 'utf8');
  const rollback = source.slice(
    source.indexOf('function rollbackFailedOperation('),
    source.indexOf('\n  const updateLocalStock', source.indexOf('function rollbackFailedOperation(')),
  );
  const reviewIndex = rollback.indexOf('requiresConsignmentPhysicalReview(item)');
  assert.ok(reviewIndex >= 0);
  assert.ok(reviewIndex < rollback.indexOf('loadOrMigrateLedger()'));
  assert.match(rollback, /markConsignmentPhysicalDeliveryReviewRequired\(item\.id\)/);
  assert.doesNotMatch(rollback.slice(0, rollback.indexOf('if \(item\.payload\?\._ledgerApplied')), /buildReversalMovements/);

  const clearDead = source.slice(source.indexOf('clearDead: () => {'), source.indexOf('\n  removeDeadQueueItems:', source.indexOf('clearDead: () => {')));
  assert.match(
    clearDead,
    /i\.status !== 'dead' \|\| isProtectedPhysicalReviewItem\(i\)/,
  );

  const syncScreen = readFileSync(resolve(process.cwd(), 'app/sync.tsx'), 'utf8');
  assert.match(syncScreen, /physicalReview/);
  assert.match(syncScreen, /REVISIÓN REQUERIDA/);
  assert.match(syncScreen, /No se puede borrar desde el historial/);
});
