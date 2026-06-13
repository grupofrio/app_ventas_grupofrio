/**
 * Perf Fase 1 (wiring source-text): TTL de precios a jornada, debounce en
 * búsqueda (picker + ruta) y FlatList virtualizada en la lista de paradas.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');

function main() {
  const cache = read('src/services/pricelistCache.ts');
  const picker = read('src/components/domain/ProductPicker.tsx');
  const route = read('app/(tabs)/route.tsx');
  const hook = read('src/hooks/useDebouncedValue.ts');

  // TTL de jornada (10 h) exportado.
  assert.match(cache, /export const CUSTOMER_PRICE_CACHE_TTL_MS\s*=\s*10 \* 60 \* 60 \* 1000/,
    'TTL de precios debe ser una jornada (10 h) y exportado');

  // Hook de debounce sin dependencias nuevas (solo setTimeout + estado React).
  assert.match(hook, /setTimeout/, 'el hook debe usar setTimeout');
  assert.match(hook, /export function useDebouncedValue/, 'debe exportar useDebouncedValue');

  // ProductPicker: input ligado a `search`, filtro usa `debouncedSearch`.
  assert.match(picker, /useDebouncedValue\(search, 300\)/, 'picker debe debouncar la búsqueda 300ms');
  assert.match(picker, /activeCategory, debouncedSearch/, 'el filtro del picker debe depender del valor debounced');
  assert.match(picker, /value=\{search\}/, 'el input del picker sigue ligado al valor inmediato');

  // Ruta: input ligado a searchQuery, filtro usa debouncedSearchQuery.
  assert.match(route, /useDebouncedValue\(searchQuery, 300\)/, 'ruta debe debouncar la búsqueda 300ms');
  assert.match(route, /debouncedSearchQuery\.trim\(\)/, 'el filtro de ruta debe usar el valor debounced');
  assert.match(route, /onChangeText=\{setSearchQuery\}/, 'el input de ruta sigue ligado al valor inmediato');

  // Ruta: lista de paradas virtualizada con FlatList + keyExtractor + perf props.
  assert.match(route, /<FlatList/, 'la lista de paradas debe usar FlatList');
  assert.match(route, /keyExtractor=\{\(item\) => String\(item\.id\)\}/, 'FlatList debe tener keyExtractor por id');
  assert.match(route, /renderItem=\{renderStopCard\}/, 'FlatList debe usar renderItem estable');
  assert.match(route, /initialNumToRender=/, 'FlatList debe fijar initialNumToRender');
  assert.match(route, /windowSize=/, 'FlatList debe fijar windowSize');
  assert.match(route, /removeClippedSubviews/, 'FlatList debe usar removeClippedSubviews (Android bajo perfil)');
  // La tarjeta sigue abriendo el cliente con handleOpenClient.
  assert.match(route, /onPress=\{\(\) => handleOpenClient\(stop\)\}/, 'la tarjeta debe abrir cliente con handleOpenClient');
  // Ya NO se itera con .map() de paradas en un ScrollView.
  assert.doesNotMatch(route, /visibleStops\.map\(/, 'la lista de paradas ya no debe usar .map() en ScrollView');

  console.log('perf fase 1 wiring tests: ok');
}

main();
