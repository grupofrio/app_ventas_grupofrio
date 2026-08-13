import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * F3.1 — "Preparar ruta" debe ser una precarga FORZADA (invalida el caché en
 * memoria), no una que solo rellena huecos. Antes de F3.1, un segundo tap con
 * el plan/productos ya rehidratados no bajaba nada nuevo (gate `.length === 0`).
 */
const root = process.cwd();
const store = fs.readFileSync(path.join(root, 'src/stores/useRoutePreparationStore.ts'), 'utf8');

assert(/loadPlan\(\{\s*force:\s*true\s*\}\)/.test(store),
  'debe forzar la recarga del plan (invalidar caché), no solo rellenar si está vacío');

assert.doesNotMatch(
  store,
  /stops\.length === 0[\s\S]{0,80}loadPlan\(\)/,
  'la carga del plan ya no debe estar condicionada a que el caché esté vacío',
);

// El catálogo de productos se fuerza SOLO si hay conexión (loadProducts no
// trae su propio guard offline como sí lo trae loadPlan).
assert.doesNotMatch(
  store,
  /productStore\.products\.length === 0[\s\S]{0,80}loadProducts\(/,
  'la carga de productos ya no debe estar condicionada a que el catálogo esté vacío',
);
assert(/if \(auth\.warehouseId && useSyncStore\.getState\(\)\.isOnline\) \{\s*\n\s*await productStore\.loadProducts\(/.test(store),
  'la carga forzada de productos debe seguir siendo condicional a estar online (loadProducts no es offline-safe por sí sola)');

console.log('route preparation forced-reload wiring tests: ok');
