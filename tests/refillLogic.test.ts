/**
 * Refill: lista completa (sin cap), agotados primero, payload con operation_id.
 */
import assert from 'node:assert/strict';

interface Mod {
  filterAndSortRefillProducts: <T extends { id: number; name: string; default_code?: string | null; qty_available: number }>(
    products: T[], query: string,
  ) => T[];
  buildRefillPayload: (input: {
    warehouseId: number | null;
    lines: Array<{ productId: number; qty: number }>;
    notes: string; operationId: string; timestampMs: number;
  }) => any;
}

function run(m: Mod) {
  // 15 productos con stock variado (incluye agotados).
  const products = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1,
    name: `Prod ${String(i + 1).padStart(2, '0')}`,
    default_code: `P${i + 1}`,
    qty_available: i, // 0,1,2,...,14 → id 1 está agotado
  }));

  const all = m.filterAndSortRefillProducts(products, '');
  // NO se limita a 10 (el bug original).
  assert.equal(all.length, 15, 'debe mostrar TODOS los productos, no 10');
  // Agotado/bajo stock primero.
  assert.equal(all[0].qty_available, 0, 'el agotado va primero');
  assert.equal(all[0].id, 1);
  assert.ok(all[0].qty_available <= all[all.length - 1].qty_available, 'orden ascendente por stock');
  // El producto agotado (que el slice(0,10) por stock desc ocultaba) está visible.
  assert.ok(all.some((p) => p.id === 1 && p.qty_available === 0), 'el agotado sigue visible');

  // Búsqueda alcanza cualquier producto (por nombre o código).
  assert.deepEqual(m.filterAndSortRefillProducts(products, 'Prod 13').map((p) => p.id), [13]);
  assert.deepEqual(m.filterAndSortRefillProducts(products, 'p7').map((p) => p.id), [7]);
  assert.equal(m.filterAndSortRefillProducts(products, 'zzz').length, 0);

  // No muta el array original.
  const original = products.map((p) => p.id);
  m.filterAndSortRefillProducts(products, '');
  assert.deepEqual(products.map((p) => p.id), original, 'no debe mutar el store');

  // qty inválido → tratado como 0 (queda en el grupo de stock 0, no crashea).
  const withBad = m.filterAndSortRefillProducts(
    [{ id: 99, name: 'X', qty_available: NaN as unknown as number }, ...products], '',
  );
  // id 99 (NaN→0) e id 1 (0) empatan en stock 0 y van al frente (orden por nombre).
  assert.ok(withBad.slice(0, 2).some((p) => p.id === 99), 'qty inválido se trata como 0 y va al frente');
  assert.equal(withBad.length, 16);

  // Payload incluye operation_id + shape correcta.
  const payload = m.buildRefillPayload({
    warehouseId: 7,
    lines: [{ productId: 1, qty: 3 }, { productId: 2, qty: 5 }],
    notes: 'falta hielo',
    operationId: 'refill-7-123-abc',
    timestampMs: 123,
  });
  assert.equal(payload.type, 'refill');
  assert.equal(payload.model, 'van.refill.request');
  assert.equal(payload.warehouse_id, 7);
  assert.equal(payload.operation_id, 'refill-7-123-abc');
  assert.deepEqual(payload.lines, [{ product_id: 1, qty: 3 }, { product_id: 2, qty: 5 }]);
  assert.equal(payload.notes, 'falta hielo');
  assert.equal(payload.timestamp, 123);

  // Retry con MISMO operationId → mismo payload idempotente.
  const retry = m.buildRefillPayload({
    warehouseId: 7, lines: [{ productId: 1, qty: 3 }, { productId: 2, qty: 5 }],
    notes: 'falta hielo', operationId: 'refill-7-123-abc', timestampMs: 999,
  });
  assert.equal(retry.operation_id, payload.operation_id, 'retry reusa operation_id');

  console.log('refill logic tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/refillLogic.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
