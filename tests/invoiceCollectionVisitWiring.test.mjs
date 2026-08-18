import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const oldRoute = resolve('app/collect/[partnerId].tsx');
const collectRoute = resolve('app/collect/[stopId].tsx');
const checkinRoute = resolve('app/checkin/[stopId].tsx');
const authStore = resolve('src/stores/useAuthStore.ts');

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
  assert.match(source, /isInvoiceCollectionCaptureFailure/);
  assert.match(source, /collectionCaptureFailureNotice/);
  assert.match(source, /collectionCaptureResultNotice/);
  assert.match(source, /const \[reconciliationPending, setReconciliationPending\] = useState\(false\)/);
  assert.match(source, /label="Actualizar estado" onPress=\{\(\) => void loadVisit\(true\)\}/);
  assert.match(source, /collection\.customer_name/);
  assert.doesNotMatch(source, /Recibo:/);
  for (const label of ['Confirmado', 'Pendiente de confirmación', 'Revisión requerida', 'Inicia sesión de nuevo']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /beginReauthentication/);
  assert.match(source, /text: 'Iniciar sesión', onPress: beginReauthentication/);
  assert.match(source, /Operación: \$\{outcome\.operationId\}/);
  assert.match(source, /label="Reintentar" onPress=\{\(\) => void loadVisit\(true\)\}/);
  assert.match(source, /createVisitCollectionLifecycle/);
  assert.doesNotMatch(source, /useSyncStore|defaultPaymentJournalId|collectPaymentIntent|payments\/create|postRpc|odooRpc/);
  assert.doesNotMatch(source, /assertCurrentEmployeeDayBundleAllowsActions/);
  assert.doesNotMatch(action, /captureStarted/);
  assert.match(action, /isInvoiceCollectionCaptureFailure\(captureError\) \? captureError\.durableIntent : true/);
  assert.match(action, /setReconciliationPending\(true\);/);
});

test('the reauthentication action routes through the existing auth guard without destructive logout', () => {
  const source = readFileSync(authStore, 'utf8');
  const actionStart = source.lastIndexOf('beginReauthentication:');
  const action = source.slice(
    actionStart,
    source.indexOf('/**', actionStart),
  );
  assert.match(action, /set\(\{ isAuthenticated: false, error: null \}\)/);
  assert.doesNotMatch(action, /clearCurrentEncryptedFieldData|clearAuthTokens|signOut|storeRemove/);
});

test('the production capture gate remains before intent creation and direct capture', () => {
  const source = readFileSync(resolve('src/services/invoiceCollectionSync.ts'), 'utf8');
  const gated = source.slice(
    source.indexOf('export function createInvoiceCollectionGatedCapture'),
    source.indexOf('export interface InvoiceCollectionSyncBootstrapDeps'),
  );

  assert(gated.indexOf('assertCurrentEmployeeDayBundleAllowsActions') < gated.indexOf('createIntent'));
  assert(gated.indexOf('createIntent') < gated.indexOf('captureIntent'));
  assert.match(gated, /preCommitCaptureFailure/);
});

test('direct collection capture delegates to capture rather than a queue or reconnect runner', () => {
  const source = readFileSync(resolve('src/services/invoiceCollectionSync.ts'), 'utf8');
  const direct = source.slice(
    source.indexOf('export function createInvoiceCollectionDirectCapture'),
    source.indexOf('export function createInvoiceCollectionGatedCapture'),
  );

  assert.match(direct, /return currentProcessor\.capture\(intent\);/);
  assert.doesNotMatch(direct, /\benqueue\b|\breconcile\b|\brequestReconnect\b/);
});
