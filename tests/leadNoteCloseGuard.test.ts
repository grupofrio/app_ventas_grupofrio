import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import { canConfirmLiquidation, describeBlockingReason, describeLiquidationButtonBlock } from '../src/services/cashcloseGuard.ts';
import {
  countCloseBlockingSyncItems,
  shouldExposeCloseSyncing,
} from '../src/services/closeSyncBlockers.ts';
import { canCloseRoute, describeCloseSyncBlock } from '../src/services/routeCloseGuard.ts';

const REPO_ROOT = resolve();

test('a failing lead note never counts as a route-close or cash-close blocker', () => {
  const leadNotes = [
    { type: 'lead_note', status: 'pending' },
    { type: 'lead_note', status: 'error' },
    { type: 'lead_note', status: 'dead' },
    { type: 'lead_note', status: 'syncing' },
  ];
  const counts = countCloseBlockingSyncItems(leadNotes);
  assert.deepEqual(counts, { pendingCount: 0, errorCount: 0, deadCount: 0 });

  const route = { ...counts, isSyncing: false };
  assert.equal(canCloseRoute(route), true);
  assert.equal(describeCloseSyncBlock(route), null);

  const cash = { ...counts, isSyncing: false, liquidationAvailable: true };
  assert.equal(canConfirmLiquidation(cash), true);
  assert.equal(describeBlockingReason(cash), null);
  assert.equal(describeLiquidationButtonBlock({
    alreadyConfirmed: false,
    corteConfirmed: true,
    liquidationAvailable: true,
    ...counts,
    isSyncing: false,
  }), null);

  const withSale = countCloseBlockingSyncItems([
    ...leadNotes,
    { type: 'sale_order', status: 'error' },
  ]);
  assert.equal(withSale.errorCount, 1);
  assert.equal(canCloseRoute({ ...withSale, isSyncing: false }), false);
  assert.match(describeCloseSyncBlock({ ...withSale, isSyncing: false }) ?? '', /error/);
  assert.equal(canConfirmLiquidation({ ...withSale, isSyncing: false, liquidationAvailable: true }), false);
});

test('retrying only lead notes does not raise the close syncing flag', () => {
  assert.equal(shouldExposeCloseSyncing([{ type: 'lead_note' }, { type: 'lead_note' }]), false);
  assert.equal(shouldExposeCloseSyncing([{ type: 'lead_note' }, { type: 'checkout' }]), true);
  assert.equal(canCloseRoute({
    ...countCloseBlockingSyncItems([{ type: 'lead_note', status: 'syncing' }]),
    isSyncing: shouldExposeCloseSyncing([{ type: 'lead_note' }]),
  }), true);
});

test('close counters and the sync screen treat lead notes as background info', () => {
  const syncStore = readFileSync(resolve(REPO_ROOT, 'src/stores/useSyncStore.ts'), 'utf8');
  const syncScreen = readFileSync(resolve(REPO_ROOT, 'app/sync.tsx'), 'utf8');
  const counts = syncStore.match(/function computeCounts[\s\S]*?\n}/)?.[0] ?? '';

  assert.match(counts, /item\.type !== 'lead_note'/);
  assert.match(syncStore, /shouldExposeCloseSyncing\(candidates\)/);
  assert.match(syncScreen, /NOTAS AL PROSPECTO/);
  assert.match(syncScreen, /No bloquean el cierre de ruta ni el corte/);
  assert.match(syncScreen, /visibleErrors = errors\.filter\(\(i\) => i\.type !== 'lead_note'\)/);
});
