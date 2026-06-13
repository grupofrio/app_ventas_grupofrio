# KoldField — QA Performance Fase 1

**Rama:** `feat/koldfield-perf-fase1-quickwins`
**Alcance:** 3 quick wins frontend. **Sin backend, sin contratos API, sin sync queue, sin deps nuevas.**

## Cambios
1. **TTL de precios a jornada** (`src/services/pricelistCache.ts`): `CUSTOMER_PRICE_CACHE_TTL_MS` de 5 min → **10 h** (jornada operativa). En ruta sin señal, `peekCachedCustomerPrices` sirve los precios precargados en el CEDIS toda la ruta, sin re-disparar el RPC que colgaba ~45 s en ProductPicker. Caché solo de LECTURA; la venta sigue online-first y el **backend valida precio/inventario al confirmar**.
2. **Debounce de búsqueda** (`src/hooks/useDebouncedValue.ts`, nuevo): el `TextInput` queda ligado al valor inmediato (escribir es instantáneo); el filtro consume el valor **debounced 300 ms** → no se re-filtra/renderiza en cada tecla. Aplicado en **ProductPicker** (productos) y **route.tsx** (clientes planificados).
3. **FlatList en paradas** (`app/(tabs)/route.tsx`): la lista pasó de `ScrollView + .map()` a **FlatList virtualizada** (`keyExtractor` por id, `renderItem` estable con `useCallback`, `initialNumToRender=12`, `maxToRenderPerBatch=10`, `windowSize=7`, `removeClippedSubviews`). El encabezado (botones, stats, búsqueda) va en `ListHeaderComponent` como **elemento** (el `TextInput` conserva el foco).

## Pruebas manuales
- [ ] **Ruta con 30 paradas:** abre fluida; scroll sin saltos en gama baja.
- [ ] **Ruta con ~100 paradas:** abre sin congelarse (virtualización); scroll fluido.
- [ ] **Buscar cliente** en ruta: el texto aparece instantáneo al escribir; la lista filtra ~300 ms después de dejar de teclear; el campo **no pierde foco**.
- [ ] **Limpiar búsqueda** (×) y por teclado: vuelve a la lista completa.
- [ ] **Abrir cliente desde la lista:** sigue usando `handleOpenClient(stop)` → hub `/stop/[id]` (con advertencia de fuera de orden y check-in/geocerca intactos).
- [ ] **Botón "📍 Maps"** en la tarjeta sigue funcionando.
- [ ] **Toggle Mapa/Lista:** ambos abren; el mapa y su panel no se rompen.
- [ ] **Abrir ProductPicker** (en venta): carga; los precios precargados aparecen sin spinner largo.
- [ ] **Buscar producto:** texto instantáneo; lista filtra ~300 ms después; selección de producto/cantidad sigue OK.
- [ ] **Red lenta / sin red con precios cacheados:** abrir ProductPicker NO cuelga 45 s; muestra precios de la jornada (precargados en CEDIS).
- [ ] **Venta sigue online-first:** confirmar venta sin red muestra "Venta requiere conexión" (no cambia la regla de negocio).
- [ ] **Pull-to-refresh** en la lista de ruta sigue funcionando (RefreshControl en FlatList).

## Validación
- `npm run typecheck` → **limpio (exit 0)**.
- `npm test` → **110/110** (incluye `pricelistCacheStability` actualizado a TTL de jornada y `perfFase1Wiring`).

## Riesgos abiertos
- El caché de precios es **en memoria**: se invalida al reiniciar la app (persistirlo es **Fase 2**). En ese caso, el primer ProductPicker tras restart en ruta sin señal vuelve a depender de red.
- El TTL de jornada asume **precios estables intradía** (confirmar con backend; si cambian intradía, reducir TTL o invalidar al re-preparar).
- FlatList con header en `ListHeaderComponent`: validar foco del buscador en dispositivos reales de gama baja.

## Fuera de alcance (no tocado)
Sync queue, GPS timeout, boot paralelo, selectors de stores, persistencia de caché (Fase 2), imágenes, telemetría. La barrera dura de stock/negativos sigue siendo backend.
