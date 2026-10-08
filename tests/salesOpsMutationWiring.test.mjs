import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('gift and exchange use their exact deployed routes and strict response validators', () => {
  const giftService = read('src/services/gfSalesOps.ts');
  const logistics = read('src/services/gfLogistics.ts');

  assert.match(giftService, /postRest<unknown>\('\/gf\/salesops\/gift\/create'/);
  assert.match(giftService, /buildGiftCreateContractPayload\(payload\)/);
  assert.match(giftService, /parseGiftCreateResponse\(result\)/);
  assert.match(logistics, /'gf\/salesops\/exchange\/create'/);
  assert.match(logistics, /parseExchangeCreateResponse\(result,\s*\{/);
  assert.doesNotMatch(logistics, /export async function createGift\(/);
});

test('direct submissions create pending side effects only for ambiguous outcomes', () => {
  const gift = read('app/gift/[stopId].tsx');
  const exchange = read('app/exchange/[stopId].tsx');

  for (const source of [gift, exchange]) {
    assert.match(source, /classifySalesOpsMutationError\(error\)/);
    assert.match(source, /outcome\.kind !== 'definitive_rejection'/);
  }
  assert.match(exchange, /operationStatus: 'pending'/);
  assert.match(exchange, /operationStatus: 'confirmed'/);
  assert.match(exchange, /Alert\.alert\('Cambio no registrado'/);

  const giftSubmit = gift.indexOf('const result = await createGift(payload)');
  const giftConfirmedInventory = gift.indexOf('await deductLocalStockOptimistically()', giftSubmit);
  const giftRejected = gift.indexOf("Alert.alert('Regalo rechazado'", giftSubmit);
  assert.ok(giftSubmit >= 0 && giftConfirmedInventory > giftSubmit);
  assert.ok(giftRejected > giftConfirmedInventory);

  const exchangeSubmit = exchange.indexOf('response = await createExchange(exchangeCapturePayload)');
  const exchangeConfirmedInventory = exchange.indexOf('await applyExchangeStockViaLedger({', exchangeSubmit);
  const exchangeConfirmedTicket = exchange.indexOf("operationStatus: 'confirmed'", exchangeConfirmedInventory);
  assert.ok(exchangeSubmit >= 0 && exchangeConfirmedInventory > exchangeSubmit);
  assert.ok(exchangeConfirmedTicket > exchangeConfirmedInventory);
});

test('queue exhaustion holds ambiguous gift and exchange operations without rollback', () => {
  const store = read('src/stores/useSyncStore.ts');
  const holdStart = store.indexOf("if (salesOpsDisposition === 'hold')");
  const terminalStart = store.indexOf("else if (!shouldRetry || newRetries >= attemptLimit)", holdStart);
  assert.ok(holdStart >= 0);
  assert.ok(terminalStart > holdStart);
  const holdBranch = store.slice(holdStart, terminalStart);
  assert.match(holdBranch, /get\(\)\.markError\(/);
  assert.doesNotMatch(holdBranch, /markDead|rollbackFailedOperation/);
});
