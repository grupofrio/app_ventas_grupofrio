/**
 * Perf Fase 2C — badge de estado de datos (cache/sin conexión).
 * Honesto con la metadata de 2B; no inventa frescura; formato seguro.
 */
import assert from 'node:assert/strict';

interface Mod {
  describeCacheStatus: (input: {
    fromCache: boolean; cachedAtMs: number | null; isOnline: boolean; nowMs: number;
  }) => { show: boolean; label: string; detail: string | null; tone: string };
  formatAgo: (cachedAtMs: number | null, nowMs: number) => string | null;
}

function run(m: Mod) {
  const NOW = 100 * 60 * 60 * 1000; // 100 h en ms, base cómoda

  // Online + datos frescos de red → no se muestra.
  assert.equal(m.describeCacheStatus({ fromCache: false, cachedAtMs: null, isOnline: true, nowMs: NOW }).show, false);

  // Offline → "Sin conexión" (warn), aunque no haya hora.
  const off = m.describeCacheStatus({ fromCache: true, cachedAtMs: NOW - 60_000, isOnline: false, nowMs: NOW });
  assert.equal(off.show, true);
  assert.equal(off.label, 'Sin conexión');
  assert.equal(off.tone, 'warn');

  // Online + caché reciente → "Usando caché".
  const recent = m.describeCacheStatus({ fromCache: true, cachedAtMs: NOW - 30 * 60_000, isOnline: true, nowMs: NOW });
  assert.equal(recent.show, true);
  assert.equal(recent.label, 'Usando caché');
  assert.equal(recent.tone, 'info');

  // Online + caché de varias horas → "Datos de la mañana".
  const morning = m.describeCacheStatus({ fromCache: true, cachedAtMs: NOW - 5 * 60 * 60 * 1000, isOnline: true, nowMs: NOW });
  assert.equal(morning.label, 'Datos de la mañana');

  // formatAgo seguro: null, futuro, instantes, min, h, días.
  assert.equal(m.formatAgo(null, NOW), null);
  assert.equal(m.formatAgo(NOW + 10_000, NOW), null, 'futuro → null (no inventa)');
  assert.equal(m.formatAgo(NOW - 5_000, NOW), 'Actualizado hace instantes');
  assert.equal(m.formatAgo(NOW - 5 * 60_000, NOW), 'Actualizado hace 5 min');
  assert.equal(m.formatAgo(NOW - 3 * 3_600_000, NOW), 'Actualizado hace 3 h');
  assert.equal(m.formatAgo(NOW - 2 * 86_400_000, NOW), 'Actualizado hace 2 días');
  assert.equal(m.formatAgo(NOW - 86_400_000, NOW), 'Actualizado hace 1 día');

  console.log('cacheStatus tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/cacheStatus.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
