/**
 * The partner/journal collection screen is replaced in Task 7. Until then its
 * old controller must fail closed instead of feeding the generic payment queue.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCollectPaymentController } from '../src/services/collectPaymentIntent.ts';

test('legacy collection compatibility boundary cannot enqueue a manual payment', () => {
  const controller = createCollectPaymentController({
    uuid: () => '11111111-2222-4aaa-8bbb-333333333333',
    enqueue: () => {
      throw new Error('must not enqueue');
    },
  });

  const outcome = controller.submit({ amount: 50 });
  assert.deepEqual(outcome, {
    status: 'invalid',
    message: 'La cobranza por factura requiere seleccionar una factura de la parada.',
  });
  assert.equal(controller.getOperationId(), null);
});
