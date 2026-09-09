import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const screen = readFileSync(new URL('../app/newcustomer.tsx', import.meta.url), 'utf8');
assert.match(screen, /status === 'done'[\s\S]*Prospecto registrado en Odoo/);
assert.match(screen, /Esperando confirmación de Odoo/);
assert.match(screen, /Se enviará al recuperar conexión/);
assert.ok(screen.indexOf('await useSyncStore.getState().persistQueue()') < screen.indexOf('setSaved(true)'));
