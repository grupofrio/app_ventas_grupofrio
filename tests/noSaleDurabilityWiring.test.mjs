import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const screen = readFileSync(resolve(root, 'app/nosale/[stopId].tsx'), 'utf8');
const persistence = readFileSync(resolve(root, 'src/services/noSaleOperationPersistence.ts'), 'utf8');

assert.match(
  screen,
  /const persistQueue = useSyncStore\(\(s\) => s\.persistQueue\);/,
  'No Venta must await the serialized durable queue barrier before retiring evidence',
);
assert.match(
  screen,
  /await persistQueue\(\);[\s\S]{0,300}await retireNoSaleIntent\(/,
  'queue-backed No Venta must retire its encrypted intent only after the queue write resolves',
);
assert.match(
  screen,
  /markNoSaleIntentReviewRequired\(/,
  'unverifiable off-route close must preserve durable review evidence',
);
assert.match(
  screen,
  /Esta no-venta requiere revisión antes de cerrar la visita\./,
  'a restored review-required intent must be visible and must not look completed',
);
assert.doesNotMatch(
  screen,
  /cerrar[áa] solo localmente porque backend rechazó el cierre/i,
  'a definitively rejected off-route close must never finalize silently',
);
assert.match(
  persistence,
  /export async function markNoSaleIntentReviewRequired\(/,
  'review-required state must be persisted in the encrypted no-sale record',
);
assert.match(
  persistence,
  /assertNoSaleIntentCanOpen\(existing\)/,
  'persistence must fail closed even before the UI hydrates review-required state',
);
assert.match(
  screen,
  /enqueue\('offroute_visit_close',[\s\S]{0,400}\{ operationId \}/,
  'offline off-route replay must use the frozen operation UUID as the queue identity',
);
assert.match(
  screen,
  /enqueue\(\s*'checkout',[\s\S]{0,400}\{ operationId \}/,
  'normal-route no-sale checkout must use the frozen operation UUID as the queue identity',
);
assert.match(
  readFileSync(resolve(root, 'src/stores/useSyncStore.ts'), 'utf8'),
  /case 'offroute_visit_close':[\s\S]{0,500}operation_id: payload\.operation_id/,
  'the off-route dispatcher must forward the frozen UUID to REST',
);

console.log('no-sale durability wiring tests: ok');
