# KoldField — QA Performance Fase 2B (Caché persistente productos/precios)

**Rama:** `feat/koldfield-perf-fase2b-cache-persistente`
**Base:** `main` @ `4ebed74` (Fase 2A doc #31 mergeada).
**Alcance:** persistir **catálogo de productos** y **precios por cliente** durante la jornada para sobrevivir reinicios de la app en ruta. **Sin backend, sin contratos API, sin cambiar reglas de venta, sin pantalla Preparar ruta (2C), sin sync-de-regreso (2E), sin deps nuevas.**

> **Regla rectora:** el caché es **solo lectura/visualización offline**. La venta sigue **online-first** y el **backend valida stock/precio al confirmar**. Persistir productos/precios **no** habilita venta offline; el stock cacheado es **referencial**.

## Problema que resuelve
Antes, al reiniciar la app en ruta sin señal, el vendedor se quedaba **sin productos ni precios**:
- `rehydrate.ts` **borraba** el catálogo en boot (`storeRemove(PRODUCTS)`).
- `useProductStore` borraba el catálogo en cada `loadProducts`/`updateLocalStock`.
- El caché de precios (`pricelistCache`) vivía **solo en memoria**.

## Cambios
1. **Sobre de caché versionado** (`src/services/persistentCache.ts`, NUEVO, puro): `CACHE_SCHEMA_VERSION`, `buildCacheEnvelope`, `readCacheEnvelope` (ok/stale/miss), `buildContextKey`. Invalida por **versión de schema** y por **contextKey** (día/empleado/empresa/almacén). TTL de jornada. Cualquier blob malformado → `miss` sin lanzar.
2. **Serialize/hydrate de precios** (`src/services/pricelistCache.ts`, puro): `serializePriceCache`/`hydratePriceCache`. Preserva `cachedAtMs` por entrada → el **TTL por-entrada de 10 h** (`CUSTOMER_PRICE_CACHE_TTL_MS`) sigue gobernando la lectura; una entrada vencida no se rehidrata.
3. **Wiring de disco** (`src/services/offlineCache.ts`, NUEVO): persiste/rehidrata el caché de precios (AsyncStorage), `getCacheContext()` compartido, `schedulePersistPriceCache()` (persist debounced 1.5 s). Aísla AsyncStorage para no romper la testabilidad pura de `pricelistCache`.
4. **Catálogo persistente** (`src/stores/useProductStore.ts`): `persistCatalogToDisk` tras carga online y tras `updateLocalStock` (reserva/display sobreviven); `hydrateFromCache(warehouseId)` rehidrata si el contexto coincide; metadata `fromCache`/`cachedAtMs`. Se conserva la limpieza de la key legacy `entities:products`.
5. **Boot** (`src/services/rehydrate.ts`): ya **no borra** el catálogo a ciegas; rehidrata catálogo + precios desde caché de jornada (con guards de día/empleado/almacén). Solo limpia la key legacy.
6. **Triggers de persistencia**: `useRoutePreparationStore` (tras preload y retry) y `ProductPicker` (tras computar precios lazy/refresh) → `schedulePersistPriceCache()`. **Lectura del picker sin cambios**: lee de los Maps en memoria, que ahora se rehidratan en boot.

## Pruebas manuales
- [ ] **Cargar con WiFi (CEDIS):** preparar ruta / abrir catálogo → productos y precios cargan; se escribe caché (`cache:products:catalog`, `cache:prices`).
- [ ] **Cerrar app por completo** (kill) tras cargar.
- [ ] **Abrir app SIN red:** el catálogo aparece (no pantalla vacía); `inventorySource` refleja caché; badge de "datos de caché" disponible vía `fromCache` (UI formal en 2C).
- [ ] **ProductPicker sin red:** muestra productos y **precios por cliente** cacheados (de los clientes precargados en CEDIS).
- [ ] **Cache stale (TTL vencido):** si pasara la jornada, el caché se limpia y queda estado claro (no productos viejos colgados); al volver online recarga.
- [ ] **Cambio de día:** abrir al día siguiente → el caché de ayer **no** se rehidrata (contextKey distinto); recarga fresca.
- [ ] **Cambio de vendedor (re-login otro empleado):** no se ven productos/precios del anterior (contextKey distinto).
- [ ] **Venta sigue online-first:** confirmar venta con red funciona igual; sin red la venta NO se confirma offline (cola/guards existentes); el backend valida stock/precio.
- [ ] **Stock referencial:** la cantidad mostrada offline es referencial; el backend rechaza sobreventa al confirmar (pendiente hard guard backend — ver `KOLDFIELD_BACKEND_HARDENING_REQUESTS.md`).

## Pruebas automáticas (puras, node)
- `tests/persistentCache.test.ts` — sobre: ok / stale / miss (contexto, versión, corrupto sin crash).
- `tests/priceCachePersistence.test.ts` — precios sobreviven restart simulado; entrada vencida no rehidrata; corrupto → 0; pricelistId round-trip.
- `tests/productCachePersistent.test.mjs` — invariantes 2B (persiste bajo PRODUCTS_CATALOG, no bajo key legacy; sobre versionado; `hydrateFromCache`/`fromCache`; rehydrate rehidrata catálogo+precios y limpia legacy). **Reemplaza** al guard `productCacheDisabled` (política previa).

## Validación
- `npm run typecheck` → **limpio (exit 0)**.
- `npm test` → **114/114**.

## Riesgos abiertos
- **Vender contra stock viejo:** mitigado — stock cacheado **referencial**, venta online-first, backend valida (depende de hard guard backend B6/B7).
- **Precio intradía cambia:** mitigado — solo lectura; la venta revalida precio en backend; TTL 10 h. Confirmar estabilidad intradía con Sebas (B5).
- **Crecimiento de AsyncStorage:** catálogo (~100–500 productos) + dump de precios; limpieza al cambiar día/empleado y por TTL. Limpieza explícita al cierre de ruta = **2E**.
- **fromCache aún sin UI formal:** la metadata existe; el badge "datos de caché / sin conexión" se formaliza en **2C**.

## Fuera de alcance (no tocado)
Pantalla Preparar ruta (2C), sync de regreso + limpieza al cierre (2E), consignaciones-lectura/imágenes (2D), backend/contratos, reglas de venta, deps nuevas.
