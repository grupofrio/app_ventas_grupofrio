/**
 * P1: copy claro del estado de la cola de sync + razón de bloqueo de cierre.
 */
import assert from 'node:assert/strict';

interface Mod {
  describeSyncQueueState: (s: {
    pendingCount: number; errorCount: number; deadCount: number; isSyncing: boolean; isOnline?: boolean;
  }) => { tone: string; label: string; detail: string };
  describeCloseBlockReason: (s: {
    pendingCount: number; errorCount: number; deadCount: number; isSyncing: boolean;
  }) => string | null;
}

function run(m: Mod) {
  // ok
  const ok = m.describeSyncQueueState({ pendingCount: 0, errorCount: 0, deadCount: 0, isSyncing: false });
  assert.equal(ok.tone, 'ok');

  // error/dead tiene prioridad sobre todo
  assert.equal(m.describeSyncQueueState({ pendingCount: 5, errorCount: 1, deadCount: 0, isSyncing: true }).tone, 'error');
  assert.equal(m.describeSyncQueueState({ pendingCount: 0, errorCount: 0, deadCount: 2, isSyncing: false }).tone, 'error');

  // syncing sobre pending
  assert.equal(m.describeSyncQueueState({ pendingCount: 3, errorCount: 0, deadCount: 0, isSyncing: true }).tone, 'syncing');

  // pending
  const p = m.describeSyncQueueState({ pendingCount: 3, errorCount: 0, deadCount: 0, isSyncing: false });
  assert.equal(p.tone, 'pending');
  assert.match(p.label, /3/);

  // pending offline → detalle menciona sin conexión
  assert.match(
    m.describeSyncQueueState({ pendingCount: 1, errorCount: 0, deadCount: 0, isSyncing: false, isOnline: false }).detail,
    /conexi/i,
  );

  // describeCloseBlockReason
  assert.equal(m.describeCloseBlockReason({ pendingCount: 0, errorCount: 0, deadCount: 0, isSyncing: false }), null);
  assert.match(m.describeCloseBlockReason({ pendingCount: 0, errorCount: 2, deadCount: 0, isSyncing: false }) ?? '', /error/);
  assert.match(m.describeCloseBlockReason({ pendingCount: 4, errorCount: 0, deadCount: 0, isSyncing: false }) ?? '', /pendientes/);

  console.log('sync status copy tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/syncStatusCopy.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
