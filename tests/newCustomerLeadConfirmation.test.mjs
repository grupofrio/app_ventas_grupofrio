import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const screen = readFileSync(resolve(process.cwd(), 'app/newcustomer.tsx'), 'utf8');

assert.match(
  screen,
  /Alert\.alert\(\s*['"]Lead guardado localmente['"],/,
  'el alta debe confirmar que el lead se guardó localmente',
);
assert.match(
  screen,
  /pendiente de sincronizaci[oó]n(?: con Odoo)?/i,
  'la confirmación debe indicar que el lead aún está pendiente de sincronización con Odoo',
);

console.log('newcustomer lead confirmation tests: ok');
