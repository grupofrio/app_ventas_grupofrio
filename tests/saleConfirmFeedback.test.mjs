import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const saleScreen = readFileSync(
    resolve(REPO_ROOT, 'app/sale/[stopId].tsx'),
    'utf8',
  );

  assert.doesNotMatch(
    saleScreen,
    /disabled=\{!canConfirm\}/,
    'Confirmar Pedido debe quedar tocable para mostrar el motivo cuando faltan datos',
  );
  assert.match(
    saleScreen,
    /disabled=\{saleConfirmed\}/,
    'Confirmar Pedido solo debe deshabilitarse despues de guardar para evitar doble tap',
  );
  assert.match(
    saleScreen,
    /hasWarehouse/,
    'La pantalla de venta debe validar que el empleado tenga almacen antes de confirmar',
  );
  assert.match(
    saleScreen,
    /almac[eé]n del empleado/,
    'Si falta warehouseId, el aviso de faltantes debe mencionar el almacen del empleado',
  );
  assert.match(
    saleScreen,
    /await getPartnerPricelistId\(/,
    'La confirmacion debe resolver la lista de precio antes de armar el payload, no depender solo del cache',
  );
  assert.match(
    saleScreen,
    /peekResolvedPartnerPricelistId\(/,
    'Despues de resolver, la confirmacion debe mandar solo listas especificas cacheadas como seguras',
  );
  assert.match(
    saleScreen,
    /stop\._pricelistId/,
    'La confirmacion de visita especial debe usar la lista capturada en la parada virtual',
  );

  console.log('sale confirm feedback tests: ok');
}

main();
