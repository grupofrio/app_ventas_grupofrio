/**
 * P2: wiring de controles operativos (source-text). Confirma que las pantallas
 * llaman a los validadores y que offroute NO tiene un camino de venta que
 * salte la validación de stock.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');

function main() {
  const sale = read('app/sale/[stopId].tsx');
  const gift = read('app/gift/[stopId].tsx');
  const consignment = read('app/consignment/[stopId].tsx');
  const offroute = read('app/offroute.tsx');
  const routeStart = read('app/route-start.tsx');
  const routeClose = read('app/route-close.tsx');

  // Venta (P0) sigue validando stock fresco
  assert.match(sale, /findFreshStockIssues/, 'venta debe validar stock fresco');

  // Regalo (P2) valida stock
  assert.match(gift, /findFreshStockIssues/, 'regalo debe validar stock');

  // Consignación CREATE (P2) valida stock; visit/close NO se tocan
  assert.match(consignment, /findFreshStockIssues/, 'consignación-create debe validar stock');

  // Offroute: el camino de venta va a /sale (mismo flujo con validación P0),
  // sin un endpoint de venta propio que salte el guard.
  assert.match(offroute, /\/sale\/\$\{virtualStopId\}/, 'offroute debe enrutar a /sale (no bypass)');
  assert.doesNotMatch(offroute, /findFreshStockIssues/, 'offroute no reimplementa validación (la hereda de /sale)');

  // KM absurdo conectado en inicio y cierre
  assert.match(routeStart, /isAbsurdOdometer/, 'route-start debe guardar contra odómetro absurdo');
  assert.match(routeClose, /isAbsurdKmDriven|isAbsurdOdometer/, 'route-close debe guardar contra KM absurdo');

  // Consignación sigue cash-only (no se reintrodujeron métodos)
  assert.doesNotMatch(consignment, /'transfer'|'card'|'credit'/, 'consignación debe seguir cash-only');

  console.log('p2 wiring controls tests: ok');
}

main();
