import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifySalesOpsMutationError,
  parseExchangeCreateResponse,
  parseGiftCreateResponse,
  requireSalesOpsIdempotencyKey,
  resolveSalesOpsQueueFailure,
} from '../src/services/salesOpsMutationOutcome.ts';

describe('sales ops HTTP 200 outcome contract', () => {
  it('accepts the sanitized deployed gift success without requiring ok:true', () => {
    const result = parseGiftCreateResponse({
      user_message: 'Regalo registrado',
      data: {
        sale_order_id: 31834,
        sale_order_name: 'S31855',
        gift_id: false,
        gift_name: 'S31855',
        picking_id: 30833,
        state: 'sale',
        amount_total: 0,
      },
    });

    assert.equal(result.data.sale_order_id, 31834);
    assert.equal(result.data.picking_id, 30833);
    assert.equal(result.data.gift_name, 'S31855');
  });

  it('accepts the sanitized deployed exchange success without requiring ok:true', () => {
    const result = parseExchangeCreateResponse({
      user_message: 'Cambio procesado',
      data: {
        exchange_id: 54,
        exchange_name: 'EX/0054',
        picking_delivery_id: 30838,
        picking_merma_id: 30839,
        state: 'done',
      },
    }, { requireDeliveryPicking: true, requireMermaPicking: true });

    assert.equal(result.data.exchange_id, 54);
    assert.equal(result.data.exchange_name, 'EX/0054');
    assert.equal(result.data.picking_delivery_id, 30838);
    assert.equal(result.data.picking_merma_id, 30839);
  });

  it('rejects a gift missing the deployed sale order or picking identity', () => {
    for (const data of [
      { gift_id: 7, gift_name: 'LEGACY/7', picking_id: 30833, state: 'sale' },
      { sale_order_id: 31834, sale_order_name: 'S31855', gift_name: 'S31855', state: 'sale' },
    ]) {
      assert.throws(
        () => parseGiftCreateResponse({ user_message: 'Regalo registrado', data }),
        (error: unknown) => {
          assert.deepEqual(classifySalesOpsMutationError(error), { kind: 'ambiguous_result' });
          return true;
        },
      );
    }
  });

  it('rejects success-shaped responses with an unconfirmed state', () => {
    assert.throws(
      () => parseGiftCreateResponse({
        user_message: 'Regalo registrado',
        data: {
          sale_order_id: 31834,
          sale_order_name: 'S31855',
          gift_name: 'S31855',
          picking_id: 30833,
          state: 'draft',
        },
      }),
      (error: unknown) => {
        assert.deepEqual(classifySalesOpsMutationError(error), { kind: 'ambiguous_result' });
        return true;
      },
    );
    assert.throws(
      () => parseExchangeCreateResponse({
        user_message: 'Cambio procesado',
        data: {
          exchange_id: 54,
          exchange_name: 'EX/0054',
          picking_delivery_id: 30838,
          state: 'draft',
        },
      }, { requireDeliveryPicking: true, requireMermaPicking: false }),
      (error: unknown) => {
        assert.deepEqual(classifySalesOpsMutationError(error), { kind: 'ambiguous_result' });
        return true;
      },
    );
  });

  it('requires only the exchange pickings corresponding to submitted lists', () => {
    const deliveryOnly = parseExchangeCreateResponse({
      user_message: 'Cambio procesado',
      data: {
        exchange_id: 54,
        exchange_name: 'EX/0054',
        picking_delivery_id: 30838,
        picking_merma_id: false,
        state: 'done',
      },
    }, { requireDeliveryPicking: true, requireMermaPicking: false });
    assert.equal(deliveryOnly.data.picking_merma_id, null);

    assert.throws(
      () => parseExchangeCreateResponse({
        user_message: 'Cambio procesado',
        data: {
          exchange_id: 54,
          exchange_name: 'EX/0054',
          picking_delivery_id: false,
          picking_merma_id: 30839,
          state: 'done',
        },
      }, { requireDeliveryPicking: true, requireMermaPicking: true }),
      (error: unknown) => {
        assert.deepEqual(classifySalesOpsMutationError(error), { kind: 'ambiguous_result' });
        return true;
      },
    );
  });

  const parsers = [
    (value: unknown) => parseGiftCreateResponse(value),
    (value: unknown) => parseExchangeCreateResponse(
      value,
      { requireDeliveryPicking: true, requireMermaPicking: true },
    ),
  ];
  for (const [index, parse] of parsers.entries()) {
    it(`parser ${index + 1} rejects an old status:error envelope`, () => {
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

    it(`parser ${index + 1} recognizes production LOCK_BUSY without status or retry_after`, () => {
      assert.throws(
        () => parse({ ok: false, code: 'LOCK_BUSY', message: 'Operación en proceso' }),
        (error: unknown) => {
          assert.deepEqual(classifySalesOpsMutationError(error), { kind: 'busy' });
          assert.equal((error as { code?: string }).code, 'LOCK_BUSY');
          return true;
        },
      );
    });

    it(`parser ${index + 1} treats a coded production 500 rejection as definitive`, () => {
      assert.throws(
        () => parse({
          ok: false,
          code: 'SERVER_MISCONFIG',
          status: 500,
          message: 'Falta configuración operativa.',
        }),
        (error: unknown) => {
          assert.deepEqual(classifySalesOpsMutationError(error), {
            kind: 'definitive_rejection',
          });
          return true;
        },
      );
    });

    it(`parser ${index + 1} treats malformed HTTP 200 data as ambiguous`, () => {
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

  it('keeps an uncoded transport 500 ambiguous but honors a coded SERVER_MISCONFIG rejection', () => {
    const transport500 = Object.assign(new Error('HTTP 500'), {
      code: 'api_rejection',
      responseReceived: true,
      httpStatus: 500,
    });
    const functional500 = Object.assign(new Error('Falta configuración'), {
      code: 'SERVER_MISCONFIG',
      responseReceived: true,
      httpStatus: 500,
    });
    assert.deepEqual(classifySalesOpsMutationError(transport500), { kind: 'ambiguous_result' });
    assert.deepEqual(classifySalesOpsMutationError(functional500), { kind: 'definitive_rejection' });
  });
});

describe('sales ops idempotency requirement', () => {
  it('accepts direct and nested stable keys', () => {
    assert.equal(requireSalesOpsIdempotencyKey(' gift-op-1 '), 'gift-op-1');
    assert.equal(
      requireSalesOpsIdempotencyKey({ meta: { idempotency_key: 'exchange-op-1' } }),
      'exchange-op-1',
    );
  });

  it('rejects a missing key as a definitive local contract failure', () => {
    assert.throws(
      () => requireSalesOpsIdempotencyKey({ meta: {} }),
      (error: unknown) => {
        assert.deepEqual(classifySalesOpsMutationError(error), { kind: 'definitive_rejection' });
        assert.equal((error as { code?: string }).code, 'INVALID_CLIENT_PAYLOAD');
        return true;
      },
    );
  });
});
