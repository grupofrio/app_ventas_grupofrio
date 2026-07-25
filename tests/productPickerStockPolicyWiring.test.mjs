import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const picker = readFileSync(resolve(root, 'src/components/domain/ProductPicker.tsx'), 'utf8');
const visitStore = readFileSync(resolve(root, 'src/stores/useVisitStore.ts'), 'utf8');
const sale = readFileSync(resolve(root, 'app/sale/[stopId].tsx'), 'utf8');
const presale = readFileSync(resolve(root, 'app/presale.tsx'), 'utf8');
const consignment = readFileSync(resolve(root, 'app/consignment/[stopId].tsx'), 'utf8');

assert.match(picker, /stockPolicy\?:\s*ProductStockPolicy/);
assert.match(picker, /stockPolicy\s*=\s*'strict'/, 'el default debe preservar consumidores existentes');
assert.match(picker, /buildEffectiveOfflineCatalog\(\{/);
assert.match(picker, /recentProducts/);
assert.match(picker, /canSelectProduct\(\{/);
assert.match(picker, /normalizeProductQuantity\(\{/);
assert.match(picker, /formatProductStockLabel\(\{/);
assert.match(picker, /resolveInventoryCapturedAtMs\(\{[\s\S]*?cachedAtMs,[\s\S]*?lastSyncAtMs,/);
assert.match(picker, /buildProductSelectionContextKey\(\{[\s\S]*?isOnline,[\s\S]*?freshness:\s*inventoryFreshness,[\s\S]*?catalogIdentity:\s*currentPricingContextKey/);
assert.match(picker, /selectionRuntimeRef\.current/);
const confirmStart = picker.indexOf('const confirmPending = () => {');
const liveRead = picker.indexOf('selectionRuntimeRef.current', confirmStart);
const revalidation = picker.indexOf('revalidateProductSelection({', liveRead);
const rejection = picker.indexOf('if (!revalidation.ok)', revalidation);
const safeAlert = picker.indexOf("Alert.alert(\n            'Selección desactualizada'", rejection);
const commit = picker.indexOf('commitSelection();', safeAlert);
assert(
  confirmStart >= 0
    && liveRead > confirmStart
    && revalidation > liveRead
    && rejection > revalidation
    && safeAlert > rejection
    && commit > safeAlert,
  'la confirmación diferida debe revalidar contra el contexto vivo antes de agregar',
);

assert.match(visitStore, /stock:\s*number\s*\|\s*null/);
assert.match(visitStore, /updateSaleQty:\s*\([\s\S]*?options\?:\s*\{\s*enforceStock\?:\s*boolean\s*\}/);
assert.match(visitStore, /hasStockIssues:\s*\(options\?:\s*\{\s*enforceStock\?:\s*boolean\s*\}\)/);
assert.match(visitStore, /getStockIssues:\s*\(options\?:\s*\{\s*enforceStock\?:\s*boolean\s*\}\)/);
assert.match(visitStore, /options\?\.enforceStock\s*!==\s*false/);

assert.match(sale, /const inventoryFreshness = useProductStore\(\(s\) => s\.inventoryFreshness\)/);
assert.match(sale, /const enforceCapturedStock\s*=\s*isOnline\s*&&\s*inventoryFreshness\s*===\s*'authoritative'/);
assert.match(sale, /stockPolicy="offline_sale"/);
assert.match(sale, /updateSaleQty\([\s\S]*?\{\s*enforceStock:\s*enforceCapturedStock\s*\},?\s*\)/);
assert.match(sale, /hasStockIssues\(\{\s*enforceStock:\s*enforceCapturedStock\s*\}\)/);
assert.match(sale, /getStockIssues\(\{\s*enforceStock:\s*enforceCapturedStock\s*\}\)/);
assert.match(sale, /line\.stock\s*===\s*null[\s\S]*?Stock sin validar/);

assert.doesNotMatch(presale, /stockPolicy=/, 'preventa debe conservar política estricta');
assert.doesNotMatch(consignment, /stockPolicy=/, 'consignación debe conservar política estricta');

console.log('product picker stock policy wiring tests: ok');
