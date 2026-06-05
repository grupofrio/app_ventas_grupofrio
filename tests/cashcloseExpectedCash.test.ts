import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(new URL('.', import.meta.url).pathname, '..');

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

test('cash close service preserves expected payment buckets from backend', () => {
  const gfLogistics = read('src/services/gfLogistics.ts');

  assert.match(gfLogistics, /expected_payments:\s*\{/);
  assert.match(gfLogistics, /const expectedRaw = data\.expected_payments/);
  assert.match(gfLogistics, /cash:\s*normalizeLiquidationBucket\(expectedRaw\.cash\)/);
  assert.match(gfLogistics, /credit:\s*normalizeLiquidationBucket\(expectedRaw\.credit\)/);
  assert.match(gfLogistics, /export function getLiquidationExpectedCashTotal/);
  assert.match(gfLogistics, /return summary\.expected_payments\.cash\.total/);
  assert.doesNotMatch(gfLogistics, /getLiquidationExpectedCashTotal[\s\S]*return summary\.payments\.cash\.total/);
});

test('cash close screen does not display liquidation total_expected as expected cash', () => {
  const source = read('app/cashclose.tsx');

  assert.match(source, /getLiquidationExpectedCashTotal\(liquidation\)/);
  assert.doesNotMatch(source, /Efectivo esperado'[^]*liquidation\.total_expected/);
});
