import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import { buildExchangeMovements } from '../src/domain/inventory/buildMovements.ts';
import { projectInventory } from '../src/domain/inventory/projectInventory.ts';
import { decideExchangeFailureAction } from '../src/services/exchangeSubmit.ts';

const require = createRequire(import.meta.url);

const OP = '11111111-1111-4111-8111-111111111111';
const M1 = '22222222-2222-4222-8222-222222222222';
const M2 = '33333333-3333-4333-8333-333333333333';

describe('exchange offline submit policy', () => {
  it('session expired never enqueues', () => {
    assert.equal(
      decideExchangeFailureAction({ isSessionExpired: true, isRetryable: true }),
      'session_relogin',
    );
  });

  it('retryable transport enqueues', () => {
    assert.equal(
      decideExchangeFailureAction({ isSessionExpired: false, isRetryable: true }),
      'enqueue',
    );
  });

  it('definitive validation shows error', () => {
    assert.equal(
      decideExchangeFailureAction({ isSessionExpired: false, isRetryable: false }),
      'show_error',
    );
  });
});

describe('cambio inventory projection (FE ledger)', () => {
  it('truck A=10, give 1, damaged return 1 → sellable 9, damaged 1, never +sellable', () => {
    const movements = buildExchangeMovements(
      { operation_id: OP, created_at: 't', movement_ids: [M1, M2] },
      [{ product_id: 10, qty: 1 }],
      [],
      [{ product_id: 10, qty: 1 }],
    );
    const projection = projectInventory({
      initialSnapshot: { '10': { sellable: 10 } },
      movements,
    });
    assert.equal(projection['10'].sellable, 9);
    assert.equal(projection['10'].damaged, 1);
    assert.equal(projection['10'].return_good, 0);
  });

  it('sellable-return variant uses return_good bucket only', () => {
    const movements = buildExchangeMovements(
      { operation_id: OP, created_at: 't', movement_ids: [M1, M2] },
      [{ product_id: 10, qty: 1 }],
      [{ product_id: 10, qty: 1 }],
      [],
    );
    const projection = projectInventory({
      initialSnapshot: { '10': { sellable: 10 } },
      movements,
    });
    assert.equal(projection['10'].sellable, 9);
    assert.equal(projection['10'].return_good, 1);
    assert.equal(projection['10'].damaged, 0);
  });
});

describe('ruta visita sync types', () => {
  it('registers exchange and presale durable queue types', () => {
    const sync = require('../src/types/sync.ts');
    assert.ok(sync.SYNC_ITEM_TYPES.includes('exchange'));
    assert.ok(sync.SYNC_ITEM_TYPES.includes('presale'));
    assert.equal(sync.SYNC_PRIORITY_MAP.exchange, 1);
    assert.equal(sync.SYNC_PRIORITY_MAP.presale, 1);
  });
});
