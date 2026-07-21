import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('sale screen visibly explains a failed or manual recovery lock without unsafe unlock', () => {
  const source = readFileSync(resolve(process.cwd(), 'app/sale/[stopId].tsx'), 'utf8');

  assert.match(source, /const saleRecoveryIntent\s*=\s*useVisitStore\(\(s\)\s*=>\s*s\.saleRecoveryIntent\)/);
  assert.match(source, /describeSaleRecoveryNotice\(\{[\s\S]*?saleRecoveryPersistenceFailed,[\s\S]*?hasRecoveryIntent:/);
  assert.match(source, /recoveryNotice\.show[\s\S]*?<AlertBanner[\s\S]*?message=\{recoveryNotice\.message\}/);
  assert.match(source, /saleConfirmButtonLabel\(\{[\s\S]*?saleRecoveryPersistenceFailed,[\s\S]*?hasRecoveryIntent:/);

  const noticeBlock = source.match(/\{recoveryNotice\.show[\s\S]*?\)\}/)?.[0] ?? '';
  assert.doesNotMatch(noticeBlock, /unlockSaleConfirm|clearSaleConfirmationLock|onPress/);
});
