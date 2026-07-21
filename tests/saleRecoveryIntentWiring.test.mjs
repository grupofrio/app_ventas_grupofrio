import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(process.cwd(), 'app/sale/[stopId].tsx'), 'utf8');

test('sale confirmation persists a complete intent before enqueue or createSale', () => {
  const intentIndex = source.indexOf('const recoveryIntent = createSaleRecoveryIntent(');
  const barrierIndex = source.indexOf('await persistSaleConfirmationLock(operationId, recoveryIntent)');
  const offlineIndex = source.indexOf('if (!isOnline)');
  const createIndex = source.indexOf('await createSale(');

  assert(intentIndex >= 0);
  assert(barrierIndex > intentIndex);
  assert(offlineIndex > barrierIndex);
  assert(createIndex > barrierIndex);
  assert.match(source, /queuePayload:\s*\{[\s\S]*?_clientCustomerName:[\s\S]*?_clientTotal:/);
  assert.match(source, /ticketSnapshot,[\s\S]*?photoUris:\s*\[\.\.\.salePhotoUris\]/);
});

test('direct definitive rejection awaits strict matching clear and stays fail-closed on failure', () => {
  const branch = source.match(/if \(outcome\.kind === 'definitive_rejection'\) \{[\s\S]*?\n      \}/)?.[0] ?? '';

  assert.notEqual(branch, '');
  assert.match(branch, /await clearSaleConfirmationLock\(operationId\)/);
  assert.match(branch, /setSaleRecoveryPersistenceFailed\(true\)/);
  assert.doesNotMatch(branch, /unlockSaleConfirm\(\)/);
});

test('offline, ambiguous, and success ticket paths reuse the persisted ticket snapshot', () => {
  assert.match(source, /saveSaleTicketSnapshot\(recoveryIntent\.ticketSnapshot\)/);
  assert(source.match(/saveSaleTicketSnapshot\(recoveryIntent\.ticketSnapshot\)/g)?.length >= 3);
});
