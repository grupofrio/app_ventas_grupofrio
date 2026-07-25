import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const servicePath = fileURLToPath(
  new URL('../src/services/localSaleStatusCopy.ts', import.meta.url),
);
assert.equal(
  existsSync(servicePath),
  true,
  'localSaleStatusCopy debe existir para probar el copy real de la UI',
);

const { getSaleStatusCopy } = await import(
  '../src/services/localSaleStatusCopy.ts'
);

test('maps every local lifecycle status to brief, actionable Spanish copy', () => {
  assert.deepEqual(getSaleStatusCopy('pending'), {
    label: 'Pendiente',
    detail: 'Se enviará cuando haya conexión.',
    tone: 'yellow',
    actionable: false,
  });
  assert.deepEqual(getSaleStatusCopy('syncing'), {
    label: 'Enviando',
    detail: 'Sincronizando con Odoo.',
    tone: 'blue',
    actionable: false,
  });
  assert.deepEqual(getSaleStatusCopy('retrying'), {
    label: 'Reintento pendiente',
    detail: 'Revisa la conexión o Sincronización.',
    tone: 'yellow',
    actionable: true,
  });
  assert.deepEqual(getSaleStatusCopy('error'), {
    label: 'Reintento pendiente',
    detail: 'Revisa la conexión o Sincronización.',
    tone: 'yellow',
    actionable: true,
  });
  assert.deepEqual(getSaleStatusCopy('needs_attention'), {
    label: 'Requiere atención',
    detail: 'Revisa esta venta en Sincronización.',
    tone: 'red',
    actionable: true,
  });
  assert.deepEqual(getSaleStatusCopy('updating'), {
    label: 'Actualizando',
    detail: 'Esperando confirmación de Odoo.',
    tone: 'blue',
    actionable: false,
  });
});

test('maps remote and defensive states without inventing synchronization success', () => {
  assert.deepEqual(getSaleStatusCopy('synced'), {
    label: 'Sincronizada',
    detail: 'Confirmada en Odoo.',
    tone: 'green',
    actionable: false,
  });
  assert.deepEqual(getSaleStatusCopy('unknown'), {
    label: 'Estado no disponible',
    detail: 'No se pudo confirmar el estado.',
    tone: 'dim',
    actionable: false,
  });
});

test('returns deterministic copy that cannot include a backend error or secret', () => {
  const statuses = [
    'pending',
    'syncing',
    'retrying',
    'error',
    'needs_attention',
    'updating',
    'synced',
    'unknown',
  ] as const;
  const forbidden = /traceback|authorization|bearer|password|token|sql/i;

  for (const status of statuses) {
    const first = getSaleStatusCopy(status);
    const second = getSaleStatusCopy(status);
    assert.deepEqual(first, second);
    assert.equal(forbidden.test(`${first.label} ${first.detail}`), false);
    assert(first.label.length <= 24);
    assert(first.detail.length <= 80);
  }
});
