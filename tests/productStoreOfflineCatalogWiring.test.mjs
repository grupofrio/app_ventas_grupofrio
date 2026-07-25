import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const productStore = readFileSync(
  resolve(root, 'src/stores/useProductStore.ts'),
  'utf8',
);
const rehydrate = readFileSync(resolve(root, 'src/services/rehydrate.ts'), 'utf8');

assert.match(
  productStore,
  /inventoryFreshness:\s*InventoryFreshness;/,
  'ProductState debe exponer la frescura explícita del inventario',
);
assert.match(
  productStore,
  /recentProducts:\s*RecentProductSnapshot\[\];/,
  'ProductState debe exponer el índice reciente del contexto actual',
);
assert.match(
  productStore,
  /hydrateOfflineCatalog:\s*\(warehouseId: number \| null\) => Promise<number>;/,
  'ProductState debe exponer la hidratación offline completa',
);
assert.match(
  productStore,
  /recordRecentProducts:\s*\(lines: SaleLineItem\[\]\) => Promise<void>;/,
  'ProductState debe poder registrar productos al encolar una venta',
);

assert.match(
  productStore,
  /products\.length > 0[\s\S]*persistCatalogToDisk\([\s\S]*saveLastKnownCatalogStrict\(/,
  'una carga normalizada no vacía debe guardar caché del día y last-known',
);
const authoritativeActionStart = productStore.lastIndexOf('loadProductsAuthoritative:');
const authoritativeAction = productStore.slice(
  authoritativeActionStart,
  productStore.indexOf('\n  updateLocalStock:', authoritativeActionStart),
);
assert.match(
  authoritativeAction,
  /inventoryFreshness === 'authoritative'/,
  'la API legacy de refresh debe exigir la frescura autoritativa calculada',
);
assert.match(
  authoritativeAction,
  /source === 'truck_stock'[\s\S]*source === 'stock_quant'/,
  'la API legacy debe admitir ambas fuentes scoped del contrato existente',
);
assert.match(
  authoritativeAction,
  /authoritativeProductRefreshes\.run\(/,
  'las cargas autoritativas deben pasar por single-flight según contexto',
);
const capturedEntryGeneration = authoritativeAction.indexOf(
  'const authoritativeEntryGeneration = catalogGeneration',
);
const scheduledAuthoritativeRun = authoritativeAction.indexOf(
  'authoritativeProductRefreshes.run(',
);
const entryPreflight = authoritativeAction.indexOf('isProductRefreshEntryCurrent(');
const innerTransport = authoritativeAction.indexOf('get().loadProducts(warehouseId,');
assert(
  capturedEntryGeneration >= 0
    && scheduledAuthoritativeRun > capturedEntryGeneration
    && entryPreflight > scheduledAuthoritativeRun
    && innerTransport > entryPreflight,
  'epoch/contexto deben capturarse antes de programar y validarse antes del transporte',
);
assert.match(
  authoritativeAction,
  /let loadInvocation[\s\S]*get\(\)\.loadProducts\(warehouseId,[\s\S]*isProductLoadInvocationCurrent\(/,
  'la carga autoritativa debe validar el token exacto asignado por su loadProducts interno',
);
const exactInvocationGuard = authoritativeAction.indexOf('isProductLoadInvocationCurrent(');
const sharedErrorRead = authoritativeAction.indexOf('get().error');
assert(
  exactInvocationGuard >= 0 && sharedErrorRead > exactInvocationGuard,
  'un resultado obsoleto debe rechazarse antes de leer estado autoritativo compartido',
);
assert.match(
  productStore,
  /reset:\s*\(\) =>[\s\S]*authoritativeProductRefreshes\.invalidate\(\)/,
  'reset/logout debe invalidar cualquier resultado autoritativo pendiente',
);
assert.doesNotMatch(
  productStore,
  /storeRemove(?:Strict)?\(STORAGE_KEYS\.LAST_KNOWN_CATALOG\)/,
  'un fallo o miss nunca debe borrar el último catálogo válido',
);

const hydrateAction = productStore.indexOf('hydrateOfflineCatalog: async');
const sameDayRead = productStore.indexOf('STORAGE_KEYS.PRODUCTS_CATALOG', hydrateAction);
const lastKnownRead = productStore.indexOf('loadLastKnownCatalog(', sameDayRead);
const recentRead = productStore.indexOf('loadRecentProducts(', lastKnownRead);
assert(hydrateAction >= 0, 'debe implementar hydrateOfflineCatalog');
assert(sameDayRead > hydrateAction, 'hydrateOfflineCatalog debe probar primero el caché del día');
assert(lastKnownRead > sameDayRead, 'last-known debe ser el fallback posterior al caché del día');
assert(recentRead > lastKnownRead, 'la hidratación debe cargar también el índice reciente');
assert.match(
  productStore.slice(hydrateAction),
  /inventoryFreshness:\s*hasCatalog \? 'cached' : 'unknown'/,
  'todo catálogo rehidratado, incluso de otro día, debe quedar cached',
);
assert.match(
  productStore.slice(hydrateAction),
  /hydrationGeneration[\s\S]*contextIdentity[\s\S]*return 0/,
  'la hidratación debe ignorar resultados obsoletos tras reset/cambio de contexto',
);

const recordAction = productStore.indexOf('recordRecentProducts: async');
assert(recordAction >= 0, 'debe implementar recordRecentProducts');
const recordSource = productStore.slice(recordAction, productStore.indexOf('\n  reset:', recordAction));
assert.match(recordSource, /upsertRecentProducts\(/, 'el registro reciente debe usar el LRU acotado');
assert.match(recordSource, /saveRecentProductsStrict\(/, 'el índice reciente debe guardarse estrictamente');
assert.match(
  recordSource,
  /publicListPrice = product\?\.list_price[\s\S]*listPrice:\s*(?:product \? product\.list_price : )?publicListPrice/,
  'debe guardar solo el precio público conocido',
);
assert.doesNotMatch(recordSource, /listPrice:\s*line\.price/, 'no debe reutilizar el precio específico del cliente');

assert.match(
  productStore,
  /reset:\s*\(\) =>[\s\S]*inventoryFreshness:\s*'unknown'[\s\S]*recentProducts:\s*\[\]/,
  'reset/logout debe limpiar memoria y autoridad del contexto anterior',
);
assert.match(
  rehydrate,
  /hydrateOfflineCatalog\(warehouseId\)/,
  'el arranque debe hidratar el catálogo durable y los productos recientes',
);

console.log('product store offline catalog wiring tests: ok');
