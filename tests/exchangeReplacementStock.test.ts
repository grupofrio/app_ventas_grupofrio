import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampReplacementQtyText,
  EXCHANGE_REPLACEMENT_STOCK_WARNING,
  findReplacementQtyOverages,
  initialReplacementQtyText,
  selectExchangeReplacementCatalog,
  type ExchangeReplacementStockInput,
} from '../src/services/exchangeReplacementStock.ts';

const products = [
  { id: 1, name: 'Barra 5kg', qty_display: 4, qty_available: 5 },
  { id: 2, name: 'Barra 10kg', qty_display: 0, qty_available: 3 },
  { id: 3, name: 'Cubeta', qty_available: 2 },
  { id: 4, name: 'Vaso', qty_display: 0, qty_available: 0 },
];

const trusted: ExchangeReplacementStockInput = {
  isOnline: true,
  fromCache: false,
  hasStockData: true,
  inventoryContext: 'ready',
  lastSync: 1_700_000_000_000,
};

describe('exchange replacement stock', () => {
  it('keeps only van lines with sellable quantity', () => {
    const catalog = selectExchangeReplacementCatalog(products, trusted);
    assert.equal(catalog.mode, 'van_stock');
    assert.equal(catalog.warning, null);
    assert.deepEqual(catalog.products.map((product) => product.id), [1, 3]);
  });

  it('returns an empty van catalog without blocking when nothing has stock', () => {
    const catalog = selectExchangeReplacementCatalog(
      [{ id: 4, name: 'Vaso', qty_display: 0, qty_available: 0 }],
      trusted,
    );
    assert.equal(catalog.mode, 'van_stock');
    assert.deepEqual(catalog.products, []);
    assert.equal(catalog.warning, null);
  });

  it('falls back to the full catalog when stock is offline, cached, or unknown', () => {
    const cases: ExchangeReplacementStockInput[] = [
      { ...trusted, isOnline: false },
      { ...trusted, fromCache: true },
      { ...trusted, hasStockData: false },
      { ...trusted, hasStockData: null },
      { ...trusted, inventoryContext: 'plan_unavailable' },
      { ...trusted, lastSync: null },
    ];
    for (const input of cases) {
      const catalog = selectExchangeReplacementCatalog(products, input);
      assert.equal(catalog.mode, 'full_catalog');
      assert.equal(catalog.products.length, products.length);
      assert.equal(catalog.warning, EXCHANGE_REPLACEMENT_STOCK_WARNING);
    }
  });

  it('caps the entered quantity at the available van stock', () => {
    assert.equal(clampReplacementQtyText('8', 3), '3');
    assert.equal(clampReplacementQtyText('1,5', 2), '1,5');
    assert.equal(clampReplacementQtyText('4', 1.5), '1.5');
    assert.equal(clampReplacementQtyText('', 3), '');
    assert.equal(clampReplacementQtyText('0', 3), '0');
    assert.equal(clampReplacementQtyText('2', null), '2');
    assert.equal(initialReplacementQtyText(4), '1');
    assert.equal(initialReplacementQtyText(0.25), '0.25');
    assert.equal(initialReplacementQtyText(0), '');
    assert.equal(initialReplacementQtyText(null), '1');
  });

  it('reports delivery lines that exceed the van balance', () => {
    const over = findReplacementQtyOverages([
      { productId: 1, qty: 4, productName: 'Barra 5kg' },
      { productId: 2, qty: 1, productName: 'Barra 10kg' },
      { productId: 9, qty: 1 },
    ], products);
    assert.equal(over.length, 2);
    assert.match(over[0].message, /Barra 10kg está agotado/);
    assert.match(over[1].message, /Producto #9 está agotado/);
  });
});
