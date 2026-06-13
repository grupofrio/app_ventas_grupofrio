import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * Perf Fase 2B — invariantes de catálogo persistente (reemplaza al antiguo
 * guard `productCacheDisabled`, que afirmaba la política previa de NO persistir
 * productos). 2B persiste el catálogo como caché REFERENCIAL de jornada para
 * sobrevivir reinicios en ruta, manteniendo la venta online-first (el backend
 * valida stock/precio al confirmar).
 *
 * Estas aserciones son de contenido de archivo (mismo estilo que el guard
 * anterior) porque los stores tiran de react-native y no cargan en node.
 */

const root = process.cwd();
const productStore = fs.readFileSync(path.join(root, 'src/stores/useProductStore.ts'), 'utf8');
const rehydrate = fs.readFileSync(path.join(root, 'src/services/rehydrate.ts'), 'utf8');

// 1. El catálogo AHORA se persiste, pero NO bajo la key cruda legacy
//    `entities:products` (esa solo se limpia). Se usa PRODUCTS_CATALOG.
assert(
  !productStore.includes('storeSave(STORAGE_KEYS.PRODUCTS,'),
  'no debe guardarse bajo la key legacy entities:products',
);
assert(
  productStore.includes('STORAGE_KEYS.PRODUCTS_CATALOG'),
  'el catálogo debe persistirse bajo PRODUCTS_CATALOG',
);
assert(
  productStore.includes('persistCatalogToDisk('),
  'debe existir el helper de persistencia de catálogo',
);

// 2. La persistencia va envuelta en un sobre versionado con contexto de
//    jornada (invalidación segura por día/empleado/empresa/almacén).
assert(
  productStore.includes('buildCacheEnvelope(') && productStore.includes('buildCatalogContextKey('),
  'el catálogo debe guardarse en un sobre versionado con contextKey de jornada',
);

// 3. El stock cacheado es referencial: existe la acción de rehidratar y marca
//    fromCache (no se trata como autoritativo).
assert(
  productStore.includes('hydrateFromCache:') && productStore.includes('fromCache: true'),
  'debe rehidratar marcando fromCache (stock referencial)',
);

// 4. rehydrate.ts ya NO borra el catálogo a ciegas: lo rehidrata, y solo
//    limpia la key legacy entities:products.
assert(
  rehydrate.includes('hydrateFromCache('),
  'rehydrate debe rehidratar el catálogo desde caché',
);
assert(
  rehydrate.includes('hydratePriceCacheFromDisk('),
  'rehydrate debe rehidratar el caché de precios',
);
assert(
  rehydrate.includes('await storeRemove(STORAGE_KEYS.PRODUCTS);'),
  'rehydrate debe seguir limpiando la key legacy entities:products',
);

console.log('product cache persistent (Fase 2B) tests: ok');
