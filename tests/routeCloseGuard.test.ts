/**
 * Perf Fase 2E — gate de cierre por sync pendiente + reconexión + limpieza.
 */
import assert from 'node:assert/strict';

interface GuardMod {
  unsyncedCount: (i: any) => number;
  hasUnsyncedWork: (i: any) => boolean;
  canCloseRoute: (i: any) => boolean;
  describeCloseSyncBlock: (i: any) => string | null;
  shouldCleanupJornadaCache: (ok: boolean) => boolean;
}
interface ConnMod {
  shouldProcessOnReconnect: (was: boolean, now: boolean) => boolean;
}

const CLEAN = { pendingCount: 0, errorCount: 0, deadCount: 0, isSyncing: false };

function runGuard(m: GuardMod) {
  // Cola limpia → permite cerrar, sin mensaje.
  assert.equal(m.canCloseRoute(CLEAN), true);
  assert.equal(m.hasUnsyncedWork(CLEAN), false);
  assert.equal(m.describeCloseSyncBlock(CLEAN), null);

  // pending → bloquea.
  const pending = { ...CLEAN, pendingCount: 3 };
  assert.equal(m.canCloseRoute(pending), false);
  assert.equal(m.unsyncedCount(pending), 3);
  assert.ok(m.describeCloseSyncBlock(pending)?.includes('pendiente'));
  assert.ok(m.describeCloseSyncBlock(pending)?.toLowerCase().includes('cerrar ruta'));

  // error/dead → bloquea.
  assert.equal(m.canCloseRoute({ ...CLEAN, errorCount: 1 }), false);
  assert.equal(m.canCloseRoute({ ...CLEAN, deadCount: 2 }), false);
  assert.equal(m.unsyncedCount({ ...CLEAN, errorCount: 1, deadCount: 2 }), 3);
  assert.ok(m.describeCloseSyncBlock({ ...CLEAN, errorCount: 2 })?.includes('error'));

  // syncing → bloquea con mensaje de "sincronizando".
  const syncing = { ...CLEAN, isSyncing: true };
  assert.equal(m.canCloseRoute(syncing), false);
  assert.ok(m.describeCloseSyncBlock(syncing)?.toLowerCase().includes('sincroniz'));

  // limpieza solo tras cierre exitoso.
  assert.equal(m.shouldCleanupJornadaCache(true), true);
  assert.equal(m.shouldCleanupJornadaCache(false), false);

  console.log('routeCloseGuard tests: ok');
}

function runConn(m: ConnMod) {
  // Solo flanco offline→online dispara sync (una sola vez).
  assert.equal(m.shouldProcessOnReconnect(false, true), true, 'offline→online dispara');
  assert.equal(m.shouldProcessOnReconnect(true, true), false, 'ya online → no redispara');
  assert.equal(m.shouldProcessOnReconnect(true, false), false, 'online→offline no dispara');
  assert.equal(m.shouldProcessOnReconnect(false, false), false, 'sigue offline no dispara');
  console.log('connectivitySync tests: ok');
}

async function main() {
  const guard = await import(
    // @ts-ignore
    new URL('../src/services/routeCloseGuard.ts', import.meta.url).pathname
  ) as unknown as GuardMod;
  const conn = await import(
    // @ts-ignore
    new URL('../src/services/connectivitySync.ts', import.meta.url).pathname
  ) as unknown as ConnMod;
  runGuard(guard);
  runConn(conn);
}
void main();
