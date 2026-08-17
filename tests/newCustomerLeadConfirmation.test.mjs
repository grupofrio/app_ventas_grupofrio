import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const screen = readFileSync(resolve(process.cwd(), 'app/newcustomer.tsx'), 'utf8');

assert.match(
  screen,
  /Alert\.alert\(\s*['"]Prospecto guardado\. Pendiente de sincronizar\.['"],/,
  'el alta debe confirmar prospecto guardado pendiente de sincronizar (no "localmente")',
);
assert.match(
  screen,
  /sincronizar(?:á|a) con Odoo cuando haya conexi[oó]n/i,
  'la confirmación debe indicar sincronización diferida con Odoo',
);

console.log('newcustomer lead confirmation tests: ok');
