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
  describeLiquidationButtonBlock: (s: {
    alreadyConfirmed: boolean; corteConfirmed: boolean; liquidationAvailable: boolean;
    pendingCount: number; errorCount?: number; deadCount?: number; isSyncing: boolean;
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

  // ── describeLiquidationButtonBlock (fix "botón no funciona") ──────────────
  const ready = {
    alreadyConfirmed: false, corteConfirmed: true, liquidationAvailable: true,
    pendingCount: 0, errorCount: 0, deadCount: 0, isSyncing: false,
  };
  // Todo listo → null (botón habilitado, sin razón).
  assert.equal(m.describeLiquidationButtonBlock(ready), null);
  // Ya confirmada → null (no se muestra el botón).
  assert.equal(m.describeLiquidationButtonBlock({ ...ready, alreadyConfirmed: true }), null);
  // Liquidación no cargada → razón clara.
  assert.match(m.describeLiquidationButtonBlock({ ...ready, liquidationAvailable: false }) ?? '', /no está disponible/i);
  // Pendientes por sincronizar.
  assert.match(m.describeLiquidationButtonBlock({ ...ready, pendingCount: 2 }) ?? '', /pendientes/i);
  // Error/dead con pendingCount 0 (antes la card decía "Todo sincronizado").
  assert.match(m.describeLiquidationButtonBlock({ ...ready, errorCount: 1 }) ?? '', /error/i);
  assert.match(m.describeLiquidationButtonBlock({ ...ready, deadCount: 2 }) ?? '', /error/i);
  // Sincronizando.
  assert.match(m.describeLiquidationButtonBlock({ ...ready, isSyncing: true }) ?? '', /sincroniz/i);
  // Corte no confirmado → causa más común; debe guiar a confirmar el corte.
  assert.match(m.describeLiquidationButtonBlock({ ...ready, corteConfirmed: false }) ?? '', /corte/i);
  // Prioridad: pendientes ANTES que corte no confirmado.
  assert.match(
    m.describeLiquidationButtonBlock({ ...ready, corteConfirmed: false, pendingCount: 3 }) ?? '',
    /pendientes/i,
  );

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
