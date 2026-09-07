import assert from 'node:assert/strict';
import {
  TruckStockPayloadError,
  parseTruckStockResponse,
} from '../src/services/truckStockResponse.ts';

const validProduct = {
  id: 31,
  name: 'Hielo 5 kg',
  default_code: 'H5',
  list_price: 35,
  qty_available: 8,
  sale_ok: true,
  product_tmpl_id: [9, 'Hielo 5 kg'],
  weight: 5,
  categ_id: false,
};

function main() {
  const parsed = parseTruckStockResponse({
    ok: true,
    data: {
      warehouse_id: 137,
      location_id: 1908,
      inventory_source: 'route_plan',
      has_stock_data: false,
      products: [validProduct],
    },
  });
  assert.equal(parsed.hasStockData, false);
  assert.equal(parsed.products[0].id, validProduct.id);
  assert.equal(parsed.warehouseId, 137);
  assert.equal(parsed.locationId, 1908);
  assert.equal(parsed.inventorySource, 'route_plan');

  assert.throws(
    () => parseTruckStockResponse({ ok: false, message: 'Sesión expirada' }),
    TruckStockPayloadError,
    'una respuesta ok:false debe conservar la ruta de error y no mutar el catálogo',
  );

  for (const malformed of [
    { ok: true, data: { products: [validProduct] } },
    { ok: true, data: { has_stock_data: true, products: [{ ...validProduct, name: '' }] } },
    { ok: true, data: { has_stock_data: true, products: [{ ...validProduct, qty_available: '8' }] } },
    { ok: true, data: { has_stock_data: true, products: [null] } },
  ]) {
    assert.throws(
      () => parseTruckStockResponse(malformed),
      TruckStockPayloadError,
      'un 200 malformado debe rechazarse antes de que el store toque el catálogo',
    );
  }

  console.log('truck stock response tests: ok');
}

main();
