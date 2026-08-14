import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const api = readFileSync(resolve('src/services/api.ts'), 'utf8');
const service = readFileSync(resolve('src/services/consignment.ts'), 'utf8');
const screen = readFileSync(resolve('app/consignment/[stopId].tsx'), 'utf8');

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

console.log('consignment bearer transport tests: ok');
