import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const backendSource = readFileSync(
  '/Users/sebis/Documents/odoo/GrupoFrio/gf_logistics_ops/models/sale_order.py',
  'utf8',
);

test('sales list serializes the employee responsible for the sale ticket', () => {
  assert.match(backendSource, /"employee_name":\s*employee\.name/);
  assert.match(backendSource, /order\.x_kold_employee_id/);
  assert.match(backendSource, /order\.employee_id/);
});
