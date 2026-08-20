import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const saleScreen = source('../app/sale/[stopId].tsx');
const pendingOrders = source('../src/services/pendingOrders.ts');
const thermalTicket = source('../src/services/thermalTicketDocument.ts');
const printScreen = source('../app/print/[orderId].tsx');

assert.match(
  saleScreen,
  /hasPendingSalePriceConfirmation\(saleLines\)/,
  'direct-sale UI must derive a pending-price state from its selected lines',
);
assert.match(
  saleScreen,
  /_clientPriceConfirmation:\s*priceConfirmationPending\s*\?\s*'pending_confirmation'/,
  'recovery payload must preserve pending-price presentation metadata locally',
);
assert.match(
  pendingOrders,
  /priceConfirmationPending/,
  'sync projection must expose the pending-price marker instead of a numeric total',
);
assert.match(
  thermalTicket,
  /priceConfirmationPending/,
  'thermal printer documents must not format a pending amount as money',
);
assert.match(
  printScreen,
  /priceConfirmationPending/,
  'ticket preview must not format a pending amount as money',
);

console.log('pending sale price wiring: ok');
