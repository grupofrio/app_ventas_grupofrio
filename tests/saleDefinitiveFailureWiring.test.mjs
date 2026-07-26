import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('sync definitive rejection gates dead and rollback behind strict visit clear', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/stores/useSyncStore.ts'), 'utf8');
  const catchBlock = source.match(/const classification = classifySyncFailure[\s\S]*?return 'failed';/)?.[0] ?? '';

  assert.notEqual(catchBlock, '');
  const classifyIndex = catchBlock.indexOf('classifySyncFailure(item, error)');
  const persistTryIndex = catchBlock.indexOf('await get().markDead(');
  const gateIndex = catchBlock.indexOf('await gateSaleDefinitiveFailure(');
  const rollbackIndex = catchBlock.indexOf('rollbackFailedOperation(');
  assert.equal(classifyIndex, 23, 'el error se clasifica una sola vez al entrar al bloque');
  assert(persistTryIndex > classifyIndex, 'el terminal durable se intenta después de clasificar');
  assert(gateIndex >= 0);
  assert(gateIndex > persistTryIndex, 'la visita no se limpia antes de persistir dead + error_code');
  assert(rollbackIndex > gateIndex);
  assert.match(
    catchBlock,
    /failureCode:\s*classification\.errorCode/,
    'el gate usa la clasificación capturada, no el item previo a markDead',
  );
  assert.match(catchBlock, /if \(definitiveGate === 'deferred'\)[\s\S]*?applySaleDefinitiveClearDeferral[\s\S]*?return 'deferred'/);
  const persistFailure = catchBlock.slice(persistTryIndex, gateIndex);
  assert.match(persistFailure, /catch\s*\([^)]*\)/);
  assert.match(persistFailure, /applySyncTerminalStateDeferral/);
  assert.match(persistFailure, /return ['"]deferred['"]/);
  assert.doesNotMatch(persistFailure, /clearSaleConfirmationLock|rollbackFailedOperation/);
});

test('markDead writes the complete terminal snapshot before publishing it', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/stores/useSyncStore.ts'), 'utf8');
  const block = source.match(/markDead:\s*async\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\s*\},\n\n\s*setOnline:/)?.[0] ?? '';

  assert.notEqual(block, '');
  assert.match(block, /queuePersistence\.transformAndPersist/);
  assert.match(block, /status:\s*['"]dead['"]/);
  assert.match(block, /error_code:\s*errorCode\s*\?\?\s*null/);
  assert.match(block, /await\s+queuePersistence\.transformAndPersist/);
  assert.doesNotMatch(
    block.slice(0, block.indexOf('await queuePersistence.transformAndPersist')),
    /\bset\s*\(/,
    'no publica dead antes de que termine la escritura estricta',
  );
});
