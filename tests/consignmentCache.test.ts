/**
 * Perf Fase 2D-1 — caché de lectura de consignaciones.
 *
 * Valida los helpers PUROS + el contrato del sobre versionado:
 *   - cache válido rehidrata la consignación del cliente;
 *   - cache stale invalida (status stale);
 *   - cache corrupto no crashea (selectConsignment/readCacheEnvelope → null/miss);
 *   - create/visit/close offline bloqueados (canMutateConsignment);
 *   - contextKey de jornada distingue día/usuario.
 *
 * El round-trip a disco (AsyncStorage) es RN y no se prueba en node; se valida
 * la lógica pura que sí lo gobierna, igual que en 2B.
 */
import assert from 'node:assert/strict';

interface Consig { id: number; name: string; lines: unknown[]; state?: string }

interface CacheMod {
  CONSIGNMENT_CACHE_TTL_MS: number;
  buildConsignmentsContextKey: (ctx: { dayKey: string; employeeId: number | null; companyId: number | null }) => string;
  selectConsignment: (payload: unknown, partnerId: number) => Consig | null;
  upsertConsignment: (payload: unknown, partnerId: number, c: Consig | null) => Record<string, Consig>;
  canMutateConsignment: (isOnline: boolean) => boolean;
}

interface EnvMod {
  buildCacheEnvelope: <T>(payload: T, contextKey: string, nowMs: number) => any;
  readCacheEnvelope: <T>(raw: unknown, contextKey: string, ttlMs: number, nowMs: number) => { status: string; payload: T | null };
}

const C1: Consig = { id: 7, name: 'CON/001', state: 'active', lines: [{ product_id: 1, target_qty: 10 }] };

function run(cache: CacheMod, env: EnvMod) {
  const ctx = { dayKey: '2026-06-12', employeeId: 42, companyId: 34 };
  const key = cache.buildConsignmentsContextKey(ctx);
  const TTL = cache.CONSIGNMENT_CACHE_TTL_MS;
  const NOW = 1_000_000;

  // upsert + select (puros).
  const payload = cache.upsertConsignment({}, 99, C1);
  assert.deepEqual(cache.selectConsignment(payload, 99), C1, 'select recupera lo upserteado');
  assert.equal(cache.selectConsignment(payload, 1234), null, 'cliente sin consignación → null');

  // upsert null elimina; inmutabilidad (no muta el original).
  const removed = cache.upsertConsignment(payload, 99, null);
  assert.equal(cache.selectConsignment(removed, 99), null, 'upsert null elimina la entrada');
  assert.deepEqual(cache.selectConsignment(payload, 99), C1, 'el payload original no se mutó');

  // corrupto → null sin lanzar.
  for (const bad of [null, undefined, 42, 'x', { '99': { id: 'no', lines: [] } }, { '99': {} }]) {
    assert.equal(cache.selectConsignment(bad, 99), null, `corrupto ${JSON.stringify(bad)} → null`);
  }

  // Round-trip vía sobre: válido rehidrata.
  const envelope = env.buildCacheEnvelope(payload, key, NOW);
  const ok = env.readCacheEnvelope<Record<string, Consig>>(envelope, key, TTL, NOW + 60_000);
  assert.equal(ok.status, 'ok');
  assert.deepEqual(cache.selectConsignment(ok.payload, 99), C1, 'cache válido rehidrata consignación');

  // stale (TTL vencido) → no se usa.
  assert.equal(env.readCacheEnvelope(envelope, key, TTL, NOW + TTL + 1).status, 'stale', 'TTL vencido → stale');

  // contexto distinto (otro día/usuario) → miss.
  const otherDay = cache.buildConsignmentsContextKey({ ...ctx, dayKey: '2026-06-13' });
  assert.equal(env.readCacheEnvelope(envelope, otherDay, TTL, NOW + 1).status, 'miss', 'otro día → miss');
  const otherUser = cache.buildConsignmentsContextKey({ ...ctx, employeeId: 7 });
  assert.equal(env.readCacheEnvelope(envelope, otherUser, TTL, NOW + 1).status, 'miss', 'otro empleado → miss');

  // create/visit/close offline bloqueados; online permitido.
  assert.equal(cache.canMutateConsignment(false), false, 'offline → no mutaciones');
  assert.equal(cache.canMutateConsignment(true), true, 'online → mutaciones permitidas');

  console.log('consignmentCache tests: ok');
}

async function main() {
  const cache = await import(
    // @ts-ignore
    new URL('../src/services/consignmentCacheLogic.ts', import.meta.url).pathname
  ) as unknown as CacheMod;
  const env = await import(
    // @ts-ignore
    new URL('../src/services/persistentCache.ts', import.meta.url).pathname
  ) as unknown as EnvMod;
  run(cache, env);
}
void main();
