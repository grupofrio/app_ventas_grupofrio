import assert from 'node:assert/strict';

interface SaleSyncStateModule {
  getSaleSyncState: (
    saleOperationId: string | null,
    queue: Array<{
      id: string;
      type: string;
      status: string;
      error_message?: string | null;
      payload?: Record<string, unknown>;
    }>,
  ) => {
    status: 'none' | 'pending' | 'done' | 'failed';
    message: string | null;
    isDefinitive: boolean;
  };
}

function testPendingSaleBlocksCheckout(module: SaleSyncStateModule) {
  const actual = module.getSaleSyncState('sale-sync-1', [
    {
      id: 'sale-sync-1',
      type: 'sale_order',
      status: 'pending',
      error_message: null,
    },
  ]);

  assert.deepEqual(actual, {
    status: 'pending',
    message: null,
    isDefinitive: false,
  });
}

function testDeadSaleSurfacesFailure(module: SaleSyncStateModule) {
  const actual = module.getSaleSyncState('sale-sync-2', [
    {
      id: 'sale-sync-2',
      type: 'sale_order',
      status: 'dead',
      error_message: 'Venta rechazada por backend',
    },
  ]);

  assert.deepEqual(actual, {
    status: 'failed',
    message: 'Venta rechazada por backend',
    isDefinitive: true,
  });
}

function testErrorSaleIsFailedButNotYetDefinitive(module: SaleSyncStateModule) {
  const actual = module.getSaleSyncState('sale-sync-4', [
    {
      id: 'sale-sync-4',
      type: 'sale_order',
      status: 'error',
      error_message: 'Timeout de red',
    },
  ]);

  assert.deepEqual(actual, {
    status: 'failed',
    message: 'Timeout de red',
    isDefinitive: false,
  });
}

function testDoneSaleAllowsCheckout(module: SaleSyncStateModule) {
  const actual = module.getSaleSyncState('sale-sync-3', [
    {
      id: 'sale-sync-3',
      type: 'sale_order',
      status: 'done',
      error_message: null,
    },
  ]);

  assert.deepEqual(actual, {
    status: 'done',
    message: null,
    isDefinitive: false,
  });
}

async function main() {
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime.
    new URL('../src/services/saleSyncState.ts', import.meta.url).pathname
  ) as SaleSyncStateModule;

  testPendingSaleBlocksCheckout(module);
  testDeadSaleSurfacesFailure(module);
  testErrorSaleIsFailedButNotYetDefinitive(module);
  testDoneSaleAllowsCheckout(module);
  console.log('sale sync state tests: ok');
}

void main();
