/**
 * P0-3 (hardening): liquidación no debe confirmarse con cola pendiente/error/dead.
 */
import assert from 'node:assert/strict';

interface GuardModule {
  canConfirmLiquidation: (input: {
    pendingCount: number; isSyncing: boolean; liquidationAvailable: boolean;
    errorCount?: number; deadCount?: number;
  }) => boolean;
  describeBlockingReason: (input: {
    pendingCount: number; isSyncing: boolean; liquidationAvailable: boolean;
    errorCount?: number; deadCount?: number;
  }) => string | null;
}

function run(m: GuardModule) {
  const ok = { pendingCount: 0, isSyncing: false, liquidationAvailable: true, errorCount: 0, deadCount: 0 };
  assert.equal(m.canConfirmLiquidation(ok), true);
  assert.equal(m.describeBlockingReason(ok), null);

  // pending blocks
  assert.equal(m.canConfirmLiquidation({ ...ok, pendingCount: 2 }), false);
  // error blocks (NEW)
  assert.equal(m.canConfirmLiquidation({ ...ok, errorCount: 1 }), false);
  assert.match(m.describeBlockingReason({ ...ok, errorCount: 1 }) ?? '', /error/i);
  // dead blocks (NEW)
  assert.equal(m.canConfirmLiquidation({ ...ok, deadCount: 1 }), false);
  assert.match(m.describeBlockingReason({ ...ok, deadCount: 3 }) ?? '', /error/i);
  // syncing blocks
  assert.equal(m.canConfirmLiquidation({ ...ok, isSyncing: true }), false);
  // no liquidation data blocks
  assert.equal(m.canConfirmLiquidation({ ...ok, liquidationAvailable: false }), false);
  // back-compat: omitting error/dead defaults to 0 → allowed
  assert.equal(m.canConfirmLiquidation({ pendingCount: 0, isSyncing: false, liquidationAvailable: true }), true);

  console.log('cashclose guard tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/cashcloseGuard.ts', import.meta.url).pathname
  ) as GuardModule;
  run(m);
}
void main();
