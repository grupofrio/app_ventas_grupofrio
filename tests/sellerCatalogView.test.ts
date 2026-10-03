/**
 * Offline default catalog, 2026-10-03 (Álvaro García, U0302, Carnicería Corte y Sazón).
 *
 * The phone showed the shared ice bars first, all Agotado, under the offline
 * banner. Those prices match the company list (there is no bar rule on
 * pricelist 104), so this is not an Iguala tariff. With every quantity at 0
 * the picker sorts by name, and `[BARRA-*]` wins.
 *
 * Today's behavior fails this test: the unsearched offline list must not be
 * that alphabetical full catalog when a prior van snapshot exists.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildVanAssortmentContextKey,
  describeMissingVanAssortment,
  retainPositiveAssortment,
  selectSellerCatalogView,
  type SellerCatalogLine,
} from '../src/services/sellerCatalogView.ts';

const barras: SellerCatalogLine[] = [
  { id: 726, name: '[BARRA-12] 1/4 BARRA', default_code: 'BARRA-12', qty_display: 0, qty_available: 0 },
  { id: 728, name: '[BARRA-20] 1/2 BARRA', default_code: 'BARRA-20', qty_display: 0, qty_available: 0 },
  { id: 727, name: '[BARRA-30] 1/2 BARRA', default_code: 'BARRA-30', qty_display: 0, qty_available: 0 },
  { id: 725, name: '[BARRA-50] BARRA', default_code: 'BARRA-50', qty_display: 0, qty_available: 0 },
  { id: 724, name: '[BARRA-75] BARRA', default_code: 'BARRA-75', qty_display: 0, qty_available: 0 },
];

const vanSnapshot: SellerCatalogLine[] = [
  { id: 501, name: 'BOLSA DE HIELO 10 KG', default_code: 'H10', qty_display: 18, qty_available: 18 },
  { id: 502, name: 'CUP LIMON', default_code: 'CUP-L', qty_display: 7, qty_available: 7 },
];

function zeroed<T extends SellerCatalogLine>(lines: T[]): T[] {
  return lines.map((line) => ({ ...line, qty_display: 0, qty_available: 0 }));
}

function main() {
  const fullCatalogAllZero = [...barras, ...zeroed(vanSnapshot)];

  const offline = selectSellerCatalogView({
    products: fullCatalogAllZero,
    positiveAssortment: vanSnapshot,
    isOnline: false,
    query: '',
  });
  assert.equal(offline.mode, 'van_snapshot');
  assert.deepEqual(offline.lines.map((line) => line.id), [501, 502]);
  assert.equal(offline.lines[0].qty_display, 18);
  assert.equal(
    offline.lines.some((line) => line.name.startsWith('[BARRA')),
    false,
    'las barras en cero no pueden encabezar la lista por defecto',
  );

  const priced = selectSellerCatalogView({
    products: fullCatalogAllZero.map((line) => (
      line.id === 501 ? { ...line, list_price: 41 } : line
    )) as Array<SellerCatalogLine & { list_price?: number }>,
    positiveAssortment: vanSnapshot.map((line) => ({ ...line, list_price: 40 })),
    isOnline: false,
    query: '',
  });
  const bolsa = priced.lines.find((line) => line.id === 501) as { list_price?: number };
  assert.equal(bolsa.list_price, 41, 'el precio sigue siendo el de la última sincronización');
  assert.equal(bolsa.qty_display, 18, 'la cantidad es la del último snapshot positivo, no un inventario inventado');

  const searched = selectSellerCatalogView({
    products: fullCatalogAllZero,
    positiveAssortment: vanSnapshot,
    isOnline: false,
    query: 'barra-12',
  });
  assert.equal(searched.mode, 'search');
  assert.deepEqual(searched.lines.map((line) => line.id), [726]);
  assert.equal(searched.lines[0].qty_display, 0, 'buscar un agotado que nunca estuvo en la unidad no fabrica existencia');

  const searchedVan = selectSellerCatalogView({
    products: fullCatalogAllZero,
    positiveAssortment: vanSnapshot,
    isOnline: false,
    query: 'bolsa',
  });
  assert.equal(searchedVan.lines[0].id, 501);
  assert.equal(searchedVan.lines[0].qty_display, 18, 'la búsqueda offline conserva la cantidad del snapshot de la unidad');

  const neverSynced = selectSellerCatalogView({
    products: barras,
    positiveAssortment: null,
    isOnline: false,
    query: '',
  });
  assert.equal(neverSynced.mode, 'empty');
  assert.deepEqual(neverSynced.lines, []);
  assert.match(describeMissingVanAssortment(true), /Busca por nombre/);
  assert.match(describeMissingVanAssortment(false), /Conéctate/);

  const onlineReference = selectSellerCatalogView({
    products: fullCatalogAllZero,
    positiveAssortment: vanSnapshot,
    isOnline: true,
    query: '',
  });
  assert.equal(onlineReference.mode, 'current');
  assert.equal(
    onlineReference.lines[0].id,
    726,
    'en línea, un catálogo realmente en cero sigue mostrando la referencia del servidor',
  );

  const stillStocked = selectSellerCatalogView({
    products: [
      ...barras,
      { id: 501, name: 'BOLSA DE HIELO 10 KG', qty_display: 3, qty_available: 3 },
    ],
    positiveAssortment: vanSnapshot,
    isOnline: false,
    query: '',
  });
  assert.equal(stillStocked.mode, 'current');
  assert.equal(stillStocked.lines[0].id, 501);

  const previous = [{ id: 501, qty_available: 18 }];
  assert.equal(
    retainPositiveAssortment(previous, barras),
    previous,
    'una carga posterior toda en cero no borra el surtido de la unidad',
  );
  assert.deepEqual(
    retainPositiveAssortment(previous, [{ id: 900, qty_available: 2 }]),
    [{ id: 900, qty_available: 2 }],
  );
  assert.equal(retainPositiveAssortment(null, barras), null);

  const guadalajara = buildVanAssortmentContextKey({
    employeeId: 918,
    companyId: 34,
    warehouseId: 137,
  });
  const iguala = buildVanAssortmentContextKey({
    employeeId: 918,
    companyId: 34,
    warehouseId: 999,
  });
  assert.ok(guadalajara);
  assert.notEqual(guadalajara, iguala, 'la misma empresa no comparte el surtido entre unidades');
  assert.doesNotMatch(guadalajara, /\d{4}-\d{2}-\d{2}/, 'el día no invalida el último surtido positivo');
  assert.equal(buildVanAssortmentContextKey({
    employeeId: null,
    companyId: 34,
    warehouseId: 137,
  }), null);

  const picker = readFileSync(resolve('src/components/domain/ProductPicker.tsx'), 'utf8');
  const store = readFileSync(resolve('src/stores/useProductStore.ts'), 'utf8');
  assert.match(picker, /selectSellerCatalogView\(/);
  assert.match(store, /retainPositiveAssortment\(/);
  assert.match(store, /STORAGE_KEYS\.VAN_ASSORTMENT/);

  console.log('seller catalog view tests: ok');
}

main();
