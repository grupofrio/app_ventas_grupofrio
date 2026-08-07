import assert from 'node:assert/strict';

async function main() {
  // @ts-ignore -- Node 24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime.
    new URL('../src/services/localSaleStatusCopy.ts', import.meta.url).pathname
  );

  const { describeLocalSaleStatus, LOCAL_AMOUNT_UNAVAILABLE_LABEL } = module;

  assert.deepEqual(describeLocalSaleStatus('pending'), {
    label: 'Pendiente de sincronizar',
    tone: 'pending',
  });
  assert.deepEqual(describeLocalSaleStatus('syncing'), {
    label: 'Sincronizando',
    tone: 'active',
  });
  assert.deepEqual(describeLocalSaleStatus('retrying'), {
    label: 'Reintentando',
    tone: 'warning',
  });
  assert.deepEqual(describeLocalSaleStatus('needs_attention'), {
    label: 'Requiere atención',
    tone: 'danger',
  });
  assert.deepEqual(describeLocalSaleStatus('updating'), {
    label: 'Actualizando',
    tone: 'active',
  });

  assert.equal(LOCAL_AMOUNT_UNAVAILABLE_LABEL, 'Monto no disponible');

  console.log('local sale status copy tests: ok');
}

void main();
