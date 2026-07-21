import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('sync definitive rejection gates dead and rollback behind strict visit clear', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/stores/useSyncStore.ts'), 'utf8');
  const catchBlock = source.match(/const shouldRetry = shouldRetrySyncItemError[\s\S]*?return 'failed';/)?.[0] ?? '';

  assert.notEqual(catchBlock, '');
  const gateIndex = catchBlock.indexOf('await gateSaleDefinitiveFailure(');
  const deadIndex = catchBlock.indexOf('get().markDead(');
  const rollbackIndex = catchBlock.indexOf('rollbackFailedOperation(');
  assert(gateIndex >= 0);
  assert(deadIndex > gateIndex);
  assert(rollbackIndex > gateIndex);
  assert.match(catchBlock, /if \(definitiveGate === 'deferred'\)[\s\S]*?applySaleDefinitiveClearDeferral[\s\S]*?return 'deferred'/);
});
