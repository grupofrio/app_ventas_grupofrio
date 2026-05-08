import assert from 'node:assert/strict';

interface SyncDependencyItem {
  id: string;
  status: 'pending' | 'syncing' | 'done' | 'error' | 'dead';
  dependsOn?: string[];
}

interface SyncDependenciesModule {
  areSyncDependenciesSatisfied: (
    item: SyncDependencyItem,
    fullQueue: SyncDependencyItem[],
  ) => boolean;
}

function main(module: SyncDependenciesModule) {
  const sale: SyncDependencyItem = { id: 'sale-1', status: 'error' };
  const payment: SyncDependencyItem = {
    id: 'payment-1',
    status: 'pending',
    dependsOn: ['sale-1'],
  };

  assert.equal(
    module.areSyncDependenciesSatisfied(payment, [sale, payment]),
    false,
    'dependent payment must wait when the sale is not done',
  );

  assert.equal(
    module.areSyncDependenciesSatisfied(payment, [{ ...sale, status: 'done' }, payment]),
    true,
    'dependent payment can run after the sale is done',
  );

  console.log('sync dependencies tests: ok');
}

// @ts-ignore -- Node v24 runs this ESM test harness directly.
const module = await import(
  // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
  new URL('../src/services/syncDependencies.ts', import.meta.url).pathname
) as SyncDependenciesModule;

main(module);
