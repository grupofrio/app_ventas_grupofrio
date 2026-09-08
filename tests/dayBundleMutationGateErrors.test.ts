import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DayBundleActionBlockedError,
  describeDayBundleActionBlock,
} from '../src/services/dayBundleMutationGate.ts';

test('absent day data is not reported as expired and uses seller-facing copy', () => {
  const error = new DayBundleActionBlockedError('missing');

  assert.deepEqual(describeDayBundleActionBlock(error), {
    title: 'Datos del día no disponibles',
    message: 'Este dispositivo aún no tiene los datos del día. Prepáralos antes de registrar cambios.',
    canRefresh: true,
  });
});

test('expired day data keeps the expired message without technical bundle wording', () => {
  const error = new DayBundleActionBlockedError('expired');

  assert.deepEqual(describeDayBundleActionBlock(error), {
    title: 'Datos del día vencidos',
    message: 'Los datos del día vencieron. Actualízalos antes de registrar cambios.',
    canRefresh: true,
  });
});

test('invalid local day data is reported as unreadable instead of expired', () => {
  const error = new DayBundleActionBlockedError('invalid');

  assert.deepEqual(describeDayBundleActionBlock(error), {
    title: 'Datos del día no disponibles',
    message: 'Los datos guardados no se pudieron validar. Actualízalos antes de registrar cambios.',
    canRefresh: true,
  });
});

test('blocked operational screens offer an explicit bundle renewal action', () => {
  for (const path of [
    'app/sale/[stopId].tsx',
    'app/checkout/[stopId].tsx',
    'app/customer/[partnerId].tsx',
    'app/nosale/[stopId].tsx',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /useEmployeeDayBundleStore/);
    assert.match(source, /useEmployeeDayBundleStore\.getState\(\)\.prepare\(\)/);
    assert.match(source, /describeDayBundleActionBlock/);
    assert.match(source, /Renovar ahora/);
  }
});
