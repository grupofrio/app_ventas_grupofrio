import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifySalesOpsMutationError,
  parseExchangeCreateResponse,
  parseGiftCreateResponse,
  resolveSalesOpsQueueFailure,
} from '../src/services/salesOpsMutationOutcome.ts';

describe('sales ops HTTP 200 outcome contract', () => {
  it('accepts the deployed gift success and keeps its operation identity', () => {
    const result = parseGiftCreateResponse({
      user_message: 'Regalo registrado',
      data: {
        sale_order_id: 710,
        sale_order_name: 'S0710',
        gift_id: false,
        gift_name: 'S0710',
        picking_id: 99,
        state: 'sale',
      },
    });

    assert.equal(result.data?.sale_order_id, 710);
    assert.equal(result.data?.gift_name, 'S0710');
  });

  it('accepts the deployed exchange success and keeps its operation identity', () => {
    const result = parseExchangeCreateResponse({
      user_message: 'Cambio procesado',
      data: {
        exchange_id: 81,
        exchange_name: 'EX/0081',
        picking_delivery_id: 901,
        picking_merma_id: false,
        state: 'done',
      },
    });

    assert.equal(result.data.exchange_id, 81);
    assert.equal(result.data.exchange_name, 'EX/0081');
    assert.equal(result.data.picking_merma_id, null);
  });

  for (const parse of [parseGiftCreateResponse, parseExchangeCreateResponse]) {
    it(`${parse.name} rejects an old status:error envelope`, () => {
      assert.throws(
        () => parse({
          status: 'error',
          code: 'VALIDATION_ERROR',
          user_message: 'Cantidad inválida',
          data: {},
        }),
        (error: unknown) => {
          assert.deepEqual(classifySalesOpsMutationError(error), {
            kind: 'definitive_rejection',
          });
          assert.equal((error as Error).message, 'Cantidad inválida');
          return true;
        },
      );
    });

    it(`${parse.name} preserves LOCK_BUSY as an ambiguous busy result`, () => {
      assert.throws(
        () => parse({ ok: false, code: 'LOCK_BUSY', message: 'Operación en proceso' }),
        (error: unknown) => {
          assert.deepEqual(classifySalesOpsMutationError(error), { kind: 'busy' });
          assert.equal((error as { code?: string }).code, 'LOCK_BUSY');
          return true;
        },
      );
    });

    it(`${parse.name} treats malformed HTTP 200 data as ambiguous`, () => {
      assert.throws(
        () => parse({ user_message: 'Todo bien', data: {} }),
        (error: unknown) => {
          assert.deepEqual(classifySalesOpsMutationError(error), {
            kind: 'ambiguous_result',
          });
          assert.equal((error as { code?: string }).code, 'invalid_response');
          return true;
        },
      );
    });
  }
});

describe('sales ops queue failure policy', () => {
  const busy = Object.assign(new Error('Ocupado'), {
    code: 'LOCK_BUSY',
    responseReceived: true,
  });
  const malformed = Object.assign(new Error('Respuesta inválida'), {
    code: 'invalid_response',
    responseReceived: true,
  });
  const rejected = Object.assign(new Error('Sin stock'), {
    code: 'INSUFFICIENT_STOCK',
    responseReceived: true,
    httpStatus: 409,
  });

  it('retries busy with the existing operation identity', () => {
    assert.equal(resolveSalesOpsQueueFailure('gift', busy, 1, 5), 'retry');
    assert.equal(resolveSalesOpsQueueFailure('exchange', busy, 1, 5), 'retry');
  });

  it('holds ambiguous work for reconciliation after retry exhaustion', () => {
    assert.equal(resolveSalesOpsQueueFailure('gift', malformed, 5, 5), 'hold');
    assert.equal(resolveSalesOpsQueueFailure('exchange', malformed, 5, 5), 'hold');
  });

  it('terminates a functional rejection without retrying it', () => {
    assert.equal(resolveSalesOpsQueueFailure('gift', rejected, 1, 5), 'reject');
    assert.equal(resolveSalesOpsQueueFailure('exchange', rejected, 1, 5), 'reject');
  });
});
