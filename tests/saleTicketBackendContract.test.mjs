import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const envPath = process.env.GF_CHECKOUT_PATH
  ? resolve(process.env.GF_CHECKOUT_PATH, 'gf_logistics_ops/models/sale_order.py')
  : null;

const candidatePaths = [
  envPath,
  resolve(process.cwd(), '../gf/gf_logistics_ops/models/sale_order.py'),
  resolve(process.cwd(), '../../gf/gf_logistics_ops/models/sale_order.py'),
  '/agent/repos/gf/gf_logistics_ops/models/sale_order.py',
].filter(Boolean);

const backendPath = candidatePaths.find((path) => existsSync(path));
assert.ok(
  backendPath,
  'gf sale_order.py must be available beside this app checkout '
    + '(CI checks out grupofrio/gf at ../gf; local multi-repo: /agent/repos/gf). '
    + `Tried: ${candidatePaths.join(', ')}`,
);
const backendSource = readFileSync(backendPath, 'utf8');

test('sales list serializes the employee responsible for the sale ticket', () => {
  assert.match(backendSource, /"employee_name":\s*employee\.name/);
  assert.match(backendSource, /order\.x_kold_employee_id/);
  assert.match(backendSource, /order\.employee_id/);
});
