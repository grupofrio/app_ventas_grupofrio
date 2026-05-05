import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

// These are source-level guards for the migration of sales/payments
// from the legacy /api/create_update path (sale.order / account.payment,
// which required ACLs the driver user doesn't have) to the
// gf_logistics_ops REST endpoints. If anyone re-introduces the legacy
// path these assertions must fail loudly.

function main() {
  const gfLogistics = readFileSync(
    resolve(REPO_ROOT, 'src/services/gfLogistics.ts'),
    'utf8',
  );
  const syncStore = readFileSync(
    resolve(REPO_ROOT, 'src/stores/useSyncStore.ts'),
    'utf8',
  );

  // gfLogistics exposes the new wrappers pointing at the right REST paths.
  assert.match(
    gfLogistics,
    /export async function createSale\(/,
    'createSale wrapper must exist in gfLogistics',
  );
  assert.match(
    gfLogistics,
    /export async function createPayment\(/,
    'createPayment wrapper must exist in gfLogistics',
  );
  assert.match(
    gfLogistics,
    /\$\{GF_BASE\}\/sales\/create/,
    'createSale must POST to gf/logistics/api/employee/sales/create',
  );
  assert.match(
    gfLogistics,
    /\$\{GF_BASE\}\/payments\/create/,
    'createPayment must POST to gf/logistics/api/employee/payments/create',
  );

  // useSyncStore dispatches sale_order/payment through the new wrappers.
  assert.match(
    syncStore,
    /case 'sale_order':[\s\S]*?createSale\(/,
    'sale_order dispatch must call createSale()',
  );
  assert.match(
    syncStore,
    /case 'payment':[\s\S]*?createPayment\(/,
    'payment dispatch must call createPayment()',
  );

  // Legacy writes must stay out of the sale_order / payment branches.
  // Some other cases (refill, unload...) still use /api/create_update,
  // so we scope the assertion to the two migrated branches.
  const saleBlock = syncStore.match(/case 'sale_order':[\s\S]*?break;/)?.[0] ?? '';
  const paymentBlock = syncStore.match(/case 'payment':[\s\S]*?break;/)?.[0] ?? '';

  assert.doesNotMatch(
    saleBlock,
    /sale\.order/,
    'sale_order branch must not reference legacy sale.order model',
  );
  assert.doesNotMatch(
    saleBlock,
    /postRpc\(/,
    'sale_order branch must not call postRpc anymore',
  );
  assert.doesNotMatch(
    paymentBlock,
    /account\.payment/,
    'payment branch must not reference legacy account.payment model',
  );
  assert.doesNotMatch(
    paymentBlock,
    /postRpc\(/,
    'payment branch must not call postRpc anymore',
  );

  console.log('sales migration tests: ok');
}

main();
