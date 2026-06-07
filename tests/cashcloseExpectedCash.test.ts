import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// fileURLToPath handles Windows (new URL('.').pathname leaves /C:/... → C:\C:\).
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
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

test('cash close success alert does not expose backend persistence wording', () => {
  const source = read('app/cashclose.tsx');

  assert.match(source, /El efectivo quedo confirmado en Odoo/);
  assert.doesNotMatch(source, /Alert\.alert\('Liquidacion confirmada', result\.message/);
});

test('cash close amount parser handles thousands and decimal separators', () => {
  const source = read('app/cashclose.tsx');

  assert.match(source, /lastIndexOf\('\.'\)/);
  assert.match(source, /lastIndexOf\(','\)/);
  assert.match(source, /slice\(0, decimalIndex\)\.replace\(\s*\/\[\.,\]\/g,\s*''\s*\)/);
});
