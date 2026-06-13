/**
 * Perf Fase 2B — sobre (envelope) de caché persistente de jornada.
 *
 * Valida el contrato puro de `persistentCache.ts`:
 *   - cache válido (contexto coincide, fresco) → status 'ok'
 *   - cache vencido (TTL) → status 'stale'
 *   - cache de otro día/usuario/ruta (contextKey distinto) → 'miss'
 *   - versión de schema distinta → 'miss' (invalidación por bump)
 *   - cache corrupto/malformado → 'miss' SIN lanzar (no crashea el boot)
 */

import assert from 'node:assert/strict';

interface Mod {
  CACHE_SCHEMA_VERSION: number;
  buildContextKey: (parts: Array<string | number | null | undefined>) => string;
  buildCacheEnvelope: <T>(payload: T, contextKey: string, nowMs: number) => any;
  readCacheEnvelope: <T>(
    raw: unknown,
    contextKey: string,
    ttlMs: number,
    nowMs: number,
  ) => { status: 'ok' | 'stale' | 'miss'; payload: T | null; cachedAtMs: number | null };
}

function run(m: Mod) {
  const TTL = 10 * 60 * 60 * 1000; // jornada
  const NOW = 1_000_000;
  const ctx = m.buildContextKey(['2026-06-12', 42, 34, 7]);

  // contextKey determinista + null/undefined → '-' (no colisiona con 0).
  assert.equal(m.buildContextKey(['2026-06-12', 42, 34, 7]), ctx, 'contextKey debe ser determinista');
  assert.notEqual(m.buildContextKey([null, 42, 34, 7]), m.buildContextKey([0, 42, 34, 7]),
    'null y 0 no deben colisionar');

  // cache válido → ok.
  const env = m.buildCacheEnvelope({ items: [1, 2, 3] }, ctx, NOW);
  assert.equal(env.schemaVersion, m.CACHE_SCHEMA_VERSION);
  const ok = m.readCacheEnvelope<{ items: number[] }>(env, ctx, TTL, NOW + 1000);
  assert.equal(ok.status, 'ok');
  assert.deepEqual(ok.payload, { items: [1, 2, 3] });
  assert.equal(ok.cachedAtMs, NOW);

  // dentro del TTL (casi al límite) → sigue ok.
  assert.equal(m.readCacheEnvelope(env, ctx, TTL, NOW + TTL).status, 'ok', 'en el límite del TTL sigue válido');

  // vencido → stale (payload se devuelve, pero el caller lo limpia).
  const stale = m.readCacheEnvelope(env, ctx, TTL, NOW + TTL + 1);
  assert.equal(stale.status, 'stale');

  // contexto distinto (otro día/usuario/ruta) → miss.
  const otherDay = m.buildContextKey(['2026-06-13', 42, 34, 7]);
  assert.equal(m.readCacheEnvelope(env, otherDay, TTL, NOW + 1).status, 'miss', 'otro día → miss');
  const otherUser = m.buildContextKey(['2026-06-12', 99, 34, 7]);
  assert.equal(m.readCacheEnvelope(env, otherUser, TTL, NOW + 1).status, 'miss', 'otro empleado → miss');

  // versión de schema distinta → miss.
  const bumped = { ...env, schemaVersion: m.CACHE_SCHEMA_VERSION + 1 };
  assert.equal(m.readCacheEnvelope(bumped, ctx, TTL, NOW + 1).status, 'miss', 'schema bump invalida');

  // corrupto / malformado → miss, sin lanzar.
  for (const bad of [null, undefined, 42, 'str', {}, { schemaVersion: 1 }, { payload: 1 }, []]) {
    const r = m.readCacheEnvelope(bad, ctx, TTL, NOW + 1);
    assert.equal(r.status, 'miss', `entrada corrupta ${JSON.stringify(bad)} → miss`);
    assert.equal(r.payload, null);
  }

  // cachedAtMs no numérico (corrupto pero con forma) → miss.
  assert.equal(
    m.readCacheEnvelope({ schemaVersion: m.CACHE_SCHEMA_VERSION, cachedAtMs: 'x', contextKey: ctx, payload: 1 }, ctx, TTL, NOW).status,
    'miss',
  );

  console.log('persistentCache tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/persistentCache.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
