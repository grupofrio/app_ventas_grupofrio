import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const oldRoute = resolve('app/collect/[partnerId].tsx');
const collectRoute = resolve('app/collect/[stopId].tsx');
const checkinRoute = resolve('app/checkin/[stopId].tsx');

test('invoice collection uses the stop route and removes the partner route', () => {
  assert.equal(existsSync(oldRoute), false, 'the old partner-authority route must be absent');
  assert.equal(existsSync(collectRoute), true, 'the exact-stop collection route must exist');
});

test('check-in opens collection for stop.id', () => {
  const source = readFileSync(checkinRoute, 'utf8');
  assert.match(source, /router\.push\(`\/collect\/\$\{stop\.id\}` as never\)/);
  assert.doesNotMatch(source, /\/collect\/\$\{stop\.customer_id\}/);
});

test('collection screen reads scoped bundle data and never uses the legacy payment dispatcher', () => {
  assert.equal(existsSync(collectRoute), true, 'the collection screen must exist before its wiring can be inspected');
  const source = readFileSync(collectRoute, 'utf8');
  const action = source.slice(source.indexOf('async function handleCollect'));

  assert.match(source, /loadCurrentEmployeeDayBundle/);
  assert.match(source, /createCurrentInvoiceCollectionPersistence/);
  assert.match(source, /buildVisitCollectionState/);
  assert.match(source, /captureCurrentInvoiceCollection/);
  assert.doesNotMatch(source, /useSyncStore|defaultPaymentJournalId|collectPaymentIntent|payments\/create|postRpc|odooRpc/);
  assert(action.indexOf('assertCurrentEmployeeDayBundleAllowsActions') < action.indexOf('captureCurrentInvoiceCollection'), 'the mutation gate must run before direct capture');
});

test('direct collection capture delegates to capture rather than a queue or reconnect runner', () => {
  const source = readFileSync(resolve('src/services/invoiceCollectionSync.ts'), 'utf8');
  const direct = source.slice(
    source.indexOf('export function createInvoiceCollectionDirectCapture'),
    source.indexOf('export function createInvoiceCollectionGatedCapture'),
  );

  assert.match(direct, /return \(await current\(\)\)\.capture\(intent\);/);
  assert.doesNotMatch(direct, /\benqueue\b|\breconcile\b|\brequestReconnect\b/);
});
