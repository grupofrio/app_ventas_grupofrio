/**
 * Perf Fase 1B: helpers puros del runtime de bajo perfil.
 * - selectPersistableQueue: la cola NO pierde items (solo descarta 'done').
 * - shouldPersistVisitTick: el timer persiste cada N s, no cada segundo.
 */
import assert from 'node:assert/strict';

interface SyncMod {
  selectPersistableQueue: <T extends { status: string }>(q: T[]) => T[];
}
interface VisitMod {
  shouldPersistVisitTick: (elapsedSeconds: number, intervalSeconds?: number) => boolean;
}

function runQueue(m: SyncMod) {
  const q = [
    { id: 'a', status: 'pending' },
    { id: 'b', status: 'error' },
    { id: 'c', status: 'dead' },
    { id: 'd', status: 'syncing' },
    { id: 'e', status: 'done' },
  ];
  const kept = m.selectPersistableQueue(q);
  // No pierde pending/error/dead/syncing; solo descarta 'done'.
  assert.deepEqual(kept.map((i) => i.id), ['a', 'b', 'c', 'd']);
  // Sin items 'done' → no se pierde nada.
  const all = [{ id: 'x', status: 'pending' }, { id: 'y', status: 'error' }];
  assert.equal(m.selectPersistableQueue(all).length, 2);
  // Vacío → vacío.
  assert.equal(m.selectPersistableQueue([]).length, 0);
}

function runTick(m: VisitMod) {
  // No persiste cada segundo.
  assert.equal(m.shouldPersistVisitTick(1, 20), false);
  assert.equal(m.shouldPersistVisitTick(19, 20), false);
  // Persiste en múltiplos del intervalo.
  assert.equal(m.shouldPersistVisitTick(20, 20), true);
  assert.equal(m.shouldPersistVisitTick(40, 20), true);
  // 0 no persiste; default 20.
  assert.equal(m.shouldPersistVisitTick(0), false);
  assert.equal(m.shouldPersistVisitTick(20), true);
  // valores inválidos no persisten.
  assert.equal(m.shouldPersistVisitTick(NaN, 20), false);
  assert.equal(m.shouldPersistVisitTick(20, 0), false);
}

async function main() {
  const sync = await import(
    // @ts-ignore
    new URL('../src/services/syncQueuePersistence.ts', import.meta.url).pathname
  ) as SyncMod;
  const visit = await import(
    // @ts-ignore
    new URL('../src/services/visitPersistence.ts', import.meta.url).pathname
  ) as VisitMod;
  runQueue(sync);
  runTick(visit);
  console.log('perf fase 1b runtime tests: ok');
}
void main();
