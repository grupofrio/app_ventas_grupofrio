import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSalePricePresentation,
  hasPendingSalePriceConfirmation,
} from '../src/services/salePricePresentation.ts';

test('pending sale lines replace local monetary totals with Odoo confirmation copy', () => {
  const pending = hasPendingSalePriceConfirmation([
    { priceConfirmation: 'authorized' },
    { priceConfirmation: 'pending_confirmation' },
  ]);

  assert.equal(pending, true);
  assert.deepEqual(getSalePricePresentation(0, pending), {
    amount: null,
    label: 'Pendiente de confirmar por Odoo',
  });
});

test('authorized sale lines preserve their local monetary presentation', () => {
  const pending = hasPendingSalePriceConfirmation([
    { priceConfirmation: 'authorized' },
  ]);

  assert.equal(pending, false);
  assert.deepEqual(getSalePricePresentation(84.5, pending), {
    amount: 84.5,
    label: null,
  });
});
