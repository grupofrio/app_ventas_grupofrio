import assert from 'node:assert/strict';

// PR-1 — despertadores de Sync. Prueba la capa de decisión PURA de
// `src/services/syncWakeup.ts`. El cableado RN (AppState/NetInfo en
// connectivity.ts, timer en useSyncStore) se valida con el plan de campo en
// Android real (offline→pending→background→señal→foreground; backoff vencido).

type Status = 'pending' | 'syncing' | 'done' | 'error' | 'dead';
interface Item {
  status: Status;
  retries: number;
  next_retry_at: number | null;
}

const MAX = 3;
const NOW = 1_000_000;

function item(status: Status, retries = 0, next_retry_at: number | null = null): Item {
  return { status, retries, next_retry_at };
}

type Mod = typeof import('../src/services/syncWakeup.ts');

// ── Foreground / reconexión: ¿hay trabajo elegible AHORA? ──
function testEligibility(m: Mod) {
  const { isEligibleNow, hasEligibleWorkNow } = m;

  // pending siempre elegible
  assert.equal(isEligibleNow(item('pending'), NOW, MAX), true);
  // error con backoff VENCIDO → elegible (despierta)
  assert.equal(isEligibleNow(item('error', 1, NOW - 1), NOW, MAX), true);
  // error sin next_retry_at → elegible
  assert.equal(isEligibleNow(item('error', 1, null), NOW, MAX), true);
  // error con backoff FUTURO → NO elegible aún
  assert.equal(isEligibleNow(item('error', 1, NOW + 5_000), NOW, MAX), false);
  // error que agotó reintentos → NO elegible (irá/está dead)
  assert.equal(isEligibleNow(item('error', MAX, NOW - 1), NOW, MAX), false);
  // syncing / done / dead → nunca elegibles (evita doble envío de algo en vuelo)
  assert.equal(isEligibleNow(item('syncing'), NOW, MAX), false);
  assert.equal(isEligibleNow(item('done'), NOW, MAX), false);
  assert.equal(isEligibleNow(item('dead'), NOW, MAX), false);

  // hasEligibleWorkNow agrega sobre la cola
  assert.equal(hasEligibleWorkNow([], NOW, MAX), false);
  assert.equal(hasEligibleWorkNow([item('syncing'), item('done')], NOW, MAX), false);
  assert.equal(
    hasEligibleWorkNow([item('error', 1, NOW + 9_999), item('pending')], NOW, MAX),
    true,
  );
  console.log('eligibility: ok');
}

// ── Conectividad tri-estado: ¿despertar en esta transición? ──
function testNetTransition(m: Mod) {
  const { shouldWakeOnNetTransition, isPotentiallyOnline } = m;
  const on = { isConnected: true, isInternetReachable: true };
  const phantom = { isConnected: true, isInternetReachable: null };
  const offHard = { isConnected: false, isInternetReachable: false };
  const noLink = { isConnected: false, isInternetReachable: null };
  const unreachable = { isConnected: true, isInternetReachable: false };

  // offline real → NO despierta (el estado nuevo no es online)
  assert.equal(shouldWakeOnNetTransition(on, offHard), false);
  assert.equal(shouldWakeOnNetTransition(on, unreachable), false);
  assert.equal(shouldWakeOnNetTransition(phantom, noLink), false);

  // offline duro → online: despierta
  assert.equal(shouldWakeOnNetTransition(offHard, on), true);
  assert.equal(shouldWakeOnNetTransition(unreachable, on), true);

  // arranque: reachability desconocida pero con enlace → despierta (no perder
  // el despertar inicial)
  assert.equal(shouldWakeOnNetTransition(noLink, phantom), true);

  // PHANTOM→REAL: enlace ya arriba, reachability null→true → despierta.
  // Este es el bug del "online fantasma" que el flanco booleano perdía.
  assert.equal(shouldWakeOnNetTransition(phantom, on), true);

  // online estable (sin cambio de reachability) → NO despierta (evita loop)
  assert.equal(shouldWakeOnNetTransition(on, on), false);
  assert.equal(shouldWakeOnNetTransition(phantom, phantom), false);

  // sanity de isPotentiallyOnline: null NO descarta online
  assert.equal(isPotentiallyOnline(phantom), true);
  assert.equal(isPotentiallyOnline(unreachable), false);
  assert.equal(isPotentiallyOnline(offHard), false);
  console.log('net transition: ok');
}

// ── Timer de backoff: delay hasta el próximo reintento ──
function testWakeDelay(m: Mod) {
  const { nextWakeDelayMs } = m;
  const opts = { maxRetries: MAX, now: NOW, minDelayMs: 250, maxDelayMs: 60_000 };

  // sin ítems en error → nada que agendar
  assert.equal(nextWakeDelayMs([], opts), null);
  assert.equal(nextWakeDelayMs([item('pending'), item('done'), item('syncing')], opts), null);

  // error con backoff futuro → delay = tiempo restante
  assert.equal(nextWakeDelayMs([item('error', 1, NOW + 8_000)], opts), 8_000);

  // error VENCIDO → colapsa a minDelay (dispara pronto, sin busy-loop)
  assert.equal(nextWakeDelayMs([item('error', 1, NOW - 5_000)], opts), 250);
  // error sin next_retry_at → también minDelay
  assert.equal(nextWakeDelayMs([item('error', 1, null)], opts), 250);

  // varios en error → toma el MÁS PRÓXIMO
  assert.equal(
    nextWakeDelayMs(
      [item('error', 1, NOW + 30_000), item('error', 2, NOW + 3_000)],
      opts,
    ),
    3_000,
  );

  // error que agotó reintentos → NO cuenta (está/estará dead)
  assert.equal(nextWakeDelayMs([item('error', MAX, NOW + 1_000)], opts), null);

  // techo defensivo
  assert.equal(nextWakeDelayMs([item('error', 0, NOW + 999_999)], opts), 60_000);
  console.log('wake delay: ok');
}

async function main() {
  const m = (await import(
    // @ts-ignore -- import.meta solo existe en el runtime de test, no en la app.
    new URL('../src/services/syncWakeup.ts', import.meta.url).pathname
  )) as Mod;

  testEligibility(m);
  testNetTransition(m);
  testWakeDelay(m);
  console.log('syncWakeup tests: ok');
}

void main();
