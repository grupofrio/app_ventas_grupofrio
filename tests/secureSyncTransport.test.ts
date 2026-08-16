import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '..');

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

test('sync dispatcher has no generic mutation transport or retired queue branches', () => {
  const storeSource = read('src/stores/useSyncStore.ts');
  const typeSource = read('src/types/sync.ts');
  const retiredQueueTypes = /\b(?:collection|transfer|customer_create)\b/;

  assert.doesNotMatch(storeSource, /\/api\/create_update|postRpc\(/);
  assert.doesNotMatch(storeSource, retiredQueueTypes);
  assert.doesNotMatch(typeSource, retiredQueueTypes);
});

test('rehydration discards persisted queue items outside the active allowlist', async () => {
  const { restorePersistedSyncQueue } = await import('../src/services/syncQueueRehydration.ts');
  const retiredItems = ['collection', 'transfer', 'customer_create'].map((type, index) => ({
    id: `retired-${index}`,
    type,
    payload: {},
    status: 'pending',
    created_at: index,
    retries: 0,
    error_message: null,
    priority: 1,
    next_retry_at: null,
  }));
  const activeItem = {
    id: 'sale-1',
    type: 'sale_order',
    payload: {},
    status: 'syncing',
    created_at: 10,
    retries: 0,
    error_message: null,
    priority: 1,
    next_retry_at: null,
  };

  const result = restorePersistedSyncQueue([...retiredItems, activeItem]);

  assert.equal(result.discardedCount, retiredItems.length);
  assert.equal(result.syncingRecoveredCount, 1);
  assert.deepEqual(result.queue.map((item) => item.type), ['sale_order']);
  assert.equal(result.queue[0].status, 'pending');
});
