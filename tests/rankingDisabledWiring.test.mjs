import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ranking = readFileSync(resolve(process.cwd(), 'app/ranking.tsx'), 'utf8');

assert.doesNotMatch(
  ranking,
  /\/get_records|odooRpc|odooSession|call_kw|execute_kw|postRpc/,
  'Ranking no debe conservar ningún transporte ORM/RPC legacy',
);
assert.doesNotMatch(
  ranking,
  /sale\.order/,
  'Ranking no debe consultar sale.order de forma directa',
);
assert.match(
  ranking,
  /Ranking no disponible/,
  'La pantalla debe comunicar explícitamente que el ranking no está disponible',
);
assert.match(
  ranking,
  /Aún no está disponible para tu cuenta/,
  'La pantalla no debe simular datos ni intentar un fallback silencioso',
);

console.log('ranking disabled wiring tests: ok');
