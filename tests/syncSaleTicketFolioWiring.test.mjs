import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/stores/useSyncStore.ts'),
  'utf8',
);

assert.match(
  source,
  /import\s*\{\s*promoteStoredSaleTicketServerResult\s*\}\s*from\s*['"]\.\.\/services\/saleTicketStorage['"]/,
  'la cola debe importar la promoción estricta del ticket almacenado',
);

const saleCaseMatch = source.match(
  /case ['"]sale_order['"]:[\s\S]*?(?=\n\s*case ['"]checkin['"]:)/,
);
assert.ok(saleCaseMatch, 'debe existir el dispatcher de sale_order');
const saleCase = saleCaseMatch[0];

const createIndex = saleCase.indexOf(
  'const saleResult = await createSale(',
);
const promotionIndex = saleCase.indexOf(
  'const promotion = await promoteStoredSaleTicketServerResult(item.id, saleResult);',
);
assert(
  createIndex >= 0 && promotionIndex > createIndex,
  'sale_order captura el resultado y espera la promoción antes de terminar',
);
assert.match(
  saleCase,
  /const saleResult = await createSale\(\s*buildSalesCreatePayload\(payload as Record<string, unknown>\),\s*meta,?\s*\);/,
);
assert.match(
  saleCase,
  /if \(promotion === ['"]missing['"]\) \{[\s\S]*?logWarn\(\s*['"]sync['"],\s*['"]sale_ticket_odoo_folio_missing['"],\s*\{\s*operation_id:\s*item\.id,?\s*\},?\s*\);[\s\S]*?\}/,
  'un ticket ausente produce exactamente metadata operativa sanitizada',
);
assert.equal(
  (source.match(/sale_ticket_odoo_folio_missing/g) ?? []).length,
  1,
  'el ticket ausente genera una sola advertencia',
);
assert.doesNotMatch(
  saleCase,
  /logWarn\([\s\S]*?\{[\s\S]*?(?:payload|customer|partner|total|name)\s*:/,
  'la advertencia no expone payload ni datos del cliente',
);
assert.doesNotMatch(
  saleCase,
  /\btry\s*\{|\bcatch\s*\(/,
  'los errores estrictos de promoción deben propagarse al retry existente de la cola',
);
assert.doesNotMatch(
  saleCase.match(/if \(promotion === ['"]missing['"]\) \{[\s\S]*?\}/)?.[0] ?? '',
  /\bthrow\b/,
  'la ausencia confirmada del ticket no bloquea una venta sincronizada',
);

console.log('sync sale ticket folio wiring tests: ok');
