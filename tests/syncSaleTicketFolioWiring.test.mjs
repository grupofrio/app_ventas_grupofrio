import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/stores/useSyncStore.ts'),
  'utf8',
);

assert.match(
  source,
  /import\s*\{[\s\S]*?applySaleTicketFolioPromotionDeferral,[\s\S]*?applySaleTicketOdooConfirmation,[\s\S]*?isSaleTicketFolioPromotionPersistenceError,[\s\S]*?runSaleTicketOdooFolioCompletion,[\s\S]*?\}\s*from\s*['"]\.\.\/services\/syncItemCompletion['"];/,
  'sync debe importar orquestación, fase durable, guard nominal y deferral',
);

assert.match(
  source,
  /import\s*\{\s*promoteStoredSaleTicketOdooFolio\s*\}\s*from\s*['"]\.\.\/services\/saleTicketStorage['"]/,
  'la cola debe importar la promoción estricta del ticket almacenado',
);

const saleCaseMatch = source.match(
  /case ['"]sale_order['"]:[\s\S]*?(?=\n\s*case ['"]checkin['"]:)/,
);
assert.ok(saleCaseMatch, 'debe existir el dispatcher de sale_order');
const saleCase = saleCaseMatch[0];

const createIndex = saleCase.indexOf(
  'const promotion = await runSaleTicketOdooFolioCompletion({',
);
const promotionIndex = saleCase.indexOf(
  'promote: (operationId, odooFolio) =>',
);
assert(
  createIndex >= 0 && promotionIndex > createIndex,
  'sale_order orquesta confirmación durable antes de promover',
);
assert.match(
  saleCase,
  /const promotion = await runSaleTicketOdooFolioCompletion\(\{[\s\S]*?item,[\s\S]*?createSale:\s*\(\) => createSale\([\s\S]*?buildSalesCreatePayload\(payload as Record<string, unknown>\),[\s\S]*?meta,[\s\S]*?\),[\s\S]*?persistRemoteConfirmation:\s*\(operationId, odooFolio\) =>[\s\S]*?queuePersistence\.transformAndPersist\(\(queue\) =>[\s\S]*?applySaleTicketOdooConfirmation\(queue, operationId, odooFolio\)[\s\S]*?\),[\s\S]*?promote:\s*\(operationId, odooFolio\) =>[\s\S]*?promoteStoredSaleTicketOdooFolio\(operationId, odooFolio\),[\s\S]*?\}\);/,
  'createSale debe preceder una persistencia estricta de fase y la promoción',
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
  'el dispatcher deja que el wrapper nominal propague el fallo al procesador',
);
assert.doesNotMatch(
  saleCase.match(/if \(promotion === ['"]missing['"]\) \{[\s\S]*?\}/)?.[0] ?? '',
  /\bthrow\b/,
  'la ausencia confirmada del ticket no bloquea una venta sincronizada',
);

const processor = source.match(
  /async function processOneItemUnheld\([\s\S]*?\n\}\n\n\/\/ ═══ GPS Batch Processor/,
)?.[0] ?? '';
assert.notEqual(processor, '', 'debe existir el procesador individual');
const promotionGuardIndex = processor.indexOf(
  'if (isSaleTicketFolioPromotionPersistenceError(error)) {',
);
const genericClassifierIndex = processor.indexOf(
  'const classification = classifySyncFailure(item, error);',
);
assert(
  promotionGuardIndex >= 0 && genericClassifierIndex > promotionGuardIndex,
  'el guard de persistencia del folio debe ejecutarse antes del clasificador remoto',
);
const promotionGuard = processor.slice(promotionGuardIndex, genericClassifierIndex);
assert.match(
  promotionGuard,
  /applySaleTicketFolioPromotionDeferral\(\s*get\(\)\.queue,\s*error\.operationId,\s*error\.odooFolio,\s*retryAt,?\s*\)/,
);
assert.match(promotionGuard, /set\(\{ queue: newQueue, \.\.\.computeCounts\(newQueue\) \}\)/);
assert.match(promotionGuard, /schedulePersist\(\)/);
assert.match(promotionGuard, /return ['"]deferred['"]/);
assert.doesNotMatch(
  promotionGuard,
  /markDead|markError|rollbackFailedOperation|cascadeDeadToDependents|newRetries/,
  'la persistencia local nunca consume MAX_RETRIES ni mata dependencias',
);

console.log('sync sale ticket folio wiring tests: ok');
