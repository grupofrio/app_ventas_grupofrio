import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const productStore = fs.readFileSync(path.join(root, 'src/stores/useProductStore.ts'), 'utf8');
const rehydrate = fs.readFileSync(path.join(root, 'src/services/rehydrate.ts'), 'utf8');

assert(!productStore.includes('storeSave(STORAGE_KEYS.PRODUCTS'));
assert(!rehydrate.includes('storeLoad<TruckProduct[]>(STORAGE_KEYS.PRODUCTS'));
assert(rehydrate.includes('await storeRemove(STORAGE_KEYS.PRODUCTS);'));

console.log('product cache disabled tests: ok');
