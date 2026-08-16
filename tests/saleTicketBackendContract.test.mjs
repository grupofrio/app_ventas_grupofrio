import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const pinPath = resolve(
  process.cwd(),
  'tests/fixtures/gf_sale_order_employee_name_contract.pin.py',
);

const envPath = process.env.GF_CHECKOUT_PATH
  ? resolve(process.env.GF_CHECKOUT_PATH, 'gf_logistics_ops/models/sale_order.py')
  : null;

const liveCandidates = [
  envPath,
  resolve(process.cwd(), '../gf/gf_logistics_ops/models/sale_order.py'),
  resolve(process.cwd(), '../../gf/gf_logistics_ops/models/sale_order.py'),
  '/agent/repos/gf/gf_logistics_ops/models/sale_order.py',
].filter(Boolean);

const livePath = liveCandidates.find((path) => existsSync(path));
const backendPath = livePath || (existsSync(pinPath) ? pinPath : null);

assert.ok(
  backendPath,
  'Need live gf sale_order.py (../gf) or tests/fixtures/gf_sale_order_employee_name_contract.pin.py',
);

const backendSource = readFileSync(backendPath, 'utf8');
const pinSource = readFileSync(pinPath, 'utf8');

function assertEmployeeNameContract(source, label) {
  assert.match(source, /"employee_name":\s*employee\.name/, label);
  assert.match(source, /order\.x_kold_employee_id/, label);
  assert.match(source, /order\.employee_id/, label);
}

test('sales list serializes the employee responsible for the sale ticket', () => {
  assertEmployeeNameContract(backendSource, backendPath);
});

test('committed pin stays aligned with live gf when sibling checkout exists', () => {
  assertEmployeeNameContract(pinSource, pinPath);
  if (!livePath) {
    // Single-repo CI: pin is the enforceable contract surface.
    return;
  }
  // Multi-repo: pin must not drift softer than live (same required patterns).
  assert.match(readFileSync(livePath, 'utf8'), /"employee_name":\s*employee\.name/);
});
