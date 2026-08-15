import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const api = readFileSync(resolve('src/services/api.ts'), 'utf8');
const service = readFileSync(resolve('src/services/consignment.ts'), 'utf8');
const screen = readFileSync(resolve('app/consignment/[stopId].tsx'), 'utf8');
const clientEvent = readFileSync(resolve('src/utils/clientEvent.ts'), 'utf8');

assert.match(
  api,
  /headers(?:\[['\"]Authorization['\"]\]|\.Authorization)\s*=\s*`Bearer \$\{[^}]+\}`/,
  'consignment uses the shared employee REST transport with Authorization: Bearer',
);
assert.doesNotMatch(api, /X-GF-(?:Employee-)?Token/, 'shared REST transport must not send legacy token headers');

assert.match(
  service,
  /getActiveConsignment\(\s*partnerId:\s*number,?\s*\)/,
  'active consignment lookup accepts only its customer target',
);
assert.doesNotMatch(
  service,
  /my-active\?partner_id=\$\{partnerId\}[^`]*company_id/,
  'active consignment lookup must not send a client-selected company',
);

const createSection = service.slice(service.indexOf('interface CreateInput'), service.indexOf('interface CountInput'));
assert.doesNotMatch(
  createSection,
  /(?:companyId|employeeId|routePlanId|mobileLocationId|vehicleId)/,
  'create payload must omit all server-derived scope fields',
);
assert.doesNotMatch(screen, /getActiveConsignment\(partnerId,\s*companyId\)/, 'screen must not pass company context to lookup');
assert.doesNotMatch(screen, /\b(?:companyId|employeeId|routePlanId|mobileLocationId|vehicleId)\s*[:,]/, 'screen must not pass server-derived scope to create');

assert.match(
  clientEvent,
  /export function createUuidV4\(\): string \{[\s\S]*?['"]xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx['"]/,
  'consignment must use the shared UUID v4 generator',
);
const uuidFunction = clientEvent
  .match(/export function createUuidV4\(\): string \{[\s\S]*?\n\}/)?.[0]
  ?.replace('export ', '')
  .replace('(): string', '()');
assert.ok(uuidFunction, 'shared UUID v4 generator must be extractable for format verification');
const createUuidV4 = new Function(`${uuidFunction}; return createUuidV4;`)();
for (let index = 0; index < 10; index += 1) {
  assert.match(
    createUuidV4(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'generated operation id must be a UUID v4',
  );
}
assert.match(screen, /import \{ createUuidV4 \} from ['"]\.\.\/\.\.\/src\/utils\/clientEvent['"]/, 'screen imports the shared UUID v4 generator');
assert.match(screen, /function makeOperationId\(\): string \{\s*return createUuidV4\(\);\s*\}/, 'all consignment operation ids are UUID v4 values');
assert.match(screen, /const createOperationIdRef = useRef<string \| null>\(null\)/, 'create must retain an id across retry attempts');
assert.match(screen, /createOperationIdRef\.current = null; \/\/ siguiente create = nuevo id/, 'create id is reset only after success');
assert.match(
  screen,
  /const operationId = await getConsignmentPendingOperationId\('create'\);[\s\S]*?createConsignment\(\{\s*partnerId,\s*operationId,\s*lines: v\.lines,\s*\}\)/,
  'create must pass its durable stable operation id to the adapter',
);

const createPayload = createSection.slice(createSection.indexOf('const body'), createSection.indexOf('const result'));
assert.match(createSection, /operationId: string;/, 'create adapter requires an operation id');
assert.match(createPayload, /operation_id: input\.operationId/, 'create payload sends operation_id');
assert.match(
  service,
  /operation_id: input\.operationId/g,
  'create, visit and close payloads all send their operation ids',
);

console.log('consignment bearer transport tests: ok');
