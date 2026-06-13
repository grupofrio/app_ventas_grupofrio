# KoldField — Performance Fase 2: CEDIS / Caché persistente (PLAN)

**Tipo:** documento de arquitectura. **No implementa código funcional.** (PR 2A = solo este doc.)
**Rama:** `docs/koldfield-perf-fase2a-cedis-cache-plan`
**Base:** `main` @ `3d7ee58` (Fase 1 cerrada: #28/#29/#30 — typecheck limpio, tests 112/112).
**Autor del plan:** reviewer/maintainer KoldField. **Dueño backend:** Sebastián (módulos Odoo).

> **Regla rectora de Fase 2 (no negociable):** el caché es **solo para LECTURA/visualización offline**. El **backend sigue siendo la fuente final de verdad** para venta, cobro, inventario y duplicados. El caché **nunca** habilita vender offline contra stock local viejo: la venta sigue *online-first* y el backend valida stock/precio al confirmar. Esto preserva la decisión vigente en `useProductStore` y `rehydrate.ts` (productos no se rehidratan para no vender contra inventario viejo) — Fase 2 la **refina**, no la rompe.

---

## 1. Resumen ejecutivo

El vendedor prepara la ruta en el **CEDIS con WiFi**, sale a ruta con **datos móviles intermitentes**, opera leyendo de **caché**, y al **regresar** sincroniza pendientes **antes** de liquidar/cerrar.

Buena parte de la maquinaria **ya existe** en `main` y NO se reescribe:

| Pieza existente | Archivo | Estado |
|---|---|---|
| Orquestador "Preparar ruta" (plan + productos + precios, fallos por-partner, progreso, retry) | `src/stores/useRoutePreparationStore.ts` | ✅ existe |
| Helpers puros de preparación (dedupe partners, name map, frescura por plan) | `src/services/routePreparationLogic.ts` | ✅ existe |
| Card UI de preparación (montada en Home) | `src/components/domain/RoutePreparationCard.tsx`, `app/(tabs)/index.tsx` | ✅ existe |
| Caché de precios por cliente con TTL de jornada (10 h) | `src/services/pricelistCache.ts` | ✅ existe — **pero en memoria** |
| Gate de cierre/liquidación (pending/error/dead bloquean) | `src/services/cashcloseGuard.ts`, `app/cashclose.tsx` | ✅ existe y cableado |
| Cola de sync idempotente persistente (operation_id, retries, dead) | `src/stores/useSyncStore.ts` | ✅ existe |
| Capa de persistencia tipada (AsyncStorage namespaced `kf:`) | `src/persistence/storage.ts` | ✅ existe — **sin versionado** |

**Lo que realmente falta (núcleo de Fase 2):**

1. **Persistencia del catálogo/precios** que sobreviva reinicios. Hoy el caché de precios es un `Map` en memoria (`pricelistCache.ts`) y los productos se **borran a propósito** en boot (`rehydrate.ts:113`) y en cada `loadProducts`/`updateLocalStock` (`useProductStore` → `storeRemove(STORAGE_KEYS.PRODUCTS)`). Resultado: si la app se reinicia en ruta sin señal, el vendedor se queda **sin productos ni precios**.
2. **Pantalla formal "Preparar ruta"** con gate de *mínimo requerido listo* antes de salir del CEDIS. Hoy es una card en Home sin bloqueo de salida.
3. **Versionado/invalidación de caché** (schema version, TTL jornada, fallback stale, limpieza, manejo de corrupción, cambio de usuario/ruta/día). Hoy no hay ningún campo de versión en la persistencia.
4. **Caché de lectura para consignaciones activas e imágenes** (hoy online por-partner / sin Cache-Control).

**Lo que NO falta** (ya resuelto, solo verificar en 2E): el bloqueo de liquidación con pendientes sin sincronizar.

**Separación frontend-only vs backend-required:** la **persistencia y el versionado del caché son 100% frontend** y se pueden hacer ya con la `loadProducts`/`computeCustomerPrices` actuales. Lo que **requiere backend** es la **eficiencia y robustez** (descarga batch/delta, `last_updated`, `Cache-Control` en imágenes, estabilidad intradía de precios, stock guard duro). Fase 2 puede entregar valor **sin esperar backend**, y mejora cuando Sebas entrega su parte.

---

## 2. Flujo CEDIS: WiFi → ruta → regreso

```
┌─ CEDIS (WiFi) ──────────────────────────────────────────────┐
│ 1. Vendedor inicia sesión / abre app.                        │
│ 2. Home muestra "Preparar ruta" (gate: aún no listo).        │
│ 3. Toca Preparar → descarga MÍNIMO REQUERIDO:                │
│      a. plan + stops          (useRouteStore.loadPlan)       │
│      b. productos/catálogo    (useProductStore.loadProducts) │
│      c. precios por cliente   (computeCustomerPrices x stops)│
│    → TODO se ESCRIBE en caché persistente (Fase 2B).         │
│ 4. UI muestra progreso, faltantes (Pendientes: N) y errores  │
│    por-partner con botón Reintentar (ya existe en el store). │
│ 5. GATE DE SALIDA: "Listo para salir" se habilita solo si    │
│    el MÍNIMO REQUERIDO está en caché (plan+stops+productos). │
│    Precios faltantes = advertencia (no bloquea: el picker    │
│    cae a list_price y revalida online en la venta).          │
└─────────────────────────────────────────────────────────────┘
           │  vendedor sale del CEDIS, pierde WiFi
           ▼
┌─ RUTA (datos móviles / intermitencia) ──────────────────────┐
│ 6. LECTURA desde caché: catálogo, precios, datos de cliente, │
│    stops. Si la app se reinicia, rehidrata DESDE caché       │
│    persistente (no se queda en blanco).                      │
│ 7. OPERACIONES CRÍTICAS siguen online-first o a cola segura: │
│      - venta: online-first; si falla red → cola idempotente  │
│        (useSyncStore, operation_id) — el backend valida      │
│        stock/precio al confirmar.                            │
│      - cobro/consignación: igual, vía cola.                  │
│      - no-venta: ya offline (NO_SALE_REASONS hardcoded).     │
│ 8. El stock que ve el vendedor es REFERENCIAL (caché);       │
│    badge "stock referencial / sin conexión" cuando sirve de  │
│    caché. La venta no se autoriza contra el número local.    │
└─────────────────────────────────────────────────────────────┘
           │  vendedor regresa al CEDIS (WiFi)
           ▼
┌─ REGRESO (WiFi) ────────────────────────────────────────────┐
│ 9. App fuerza processQueue() al recuperar conexión           │
│    (connectivity.ts ya lo hace).                             │
│ 10. GATE DE CIERRE (ya existe, cashcloseGuard): NO se puede  │
│     liquidar/cerrar mientras pendingCount/error/dead > 0.    │
│     "Sincronizar pendientes" primero; luego corte →          │
│     liquidación → cierre.                                    │
│ 11. Al cerrar ruta del día: invalidar caché de la jornada    │
│     (limpieza), dejando intacta la cola de sync si quedara   │
│     algo (no debería, por el gate).                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Matriz de datos cacheables

| Dato | Cacheable | Persistente | TTL | Riesgo | Backend requerido | Recomendación |
|---|---|---|---|---|---|---|
| **Ruta del día (plan)** | Sí | Sí | Jornada (hasta cierre / cambio de día/empleado) | Plan viejo si el Jefe reasigna mid-día | No (ya persiste en `route:plan`) | Persistir + invalidar por `date != hoy` o `driver_employee_id != actual` (ya hecho en `rehydrate.ts:72-106`). |
| **Stops** | Sí | Sí | Jornada | Drafts offroute stale | No (ya persiste `route:stops` + GC de drafts) | Mantener; añadir versión de schema. |
| **Clientes (datos de stop)** | Sí | Sí | Jornada | Datos de contacto desactualizados | No (vienen embebidos en stops) | Lectura desde caché; edición de contacto sigue online (`customerContactUpdate`). |
| **Productos / catálogo** | Sí (catálogo) | **Sí (NUEVO)** | Jornada | **Vender contra stock viejo** | Parcial (delta/`last_updated` ideal) | **Persistir catálogo** (id, nombre, código, precio lista, categoría, peso). `qty_available` se guarda como **referencial** marcado; **no autoriza venta**. Backend valida al confirmar. |
| **Precios por cliente** | Sí | **Sí (NUEVO)** | Jornada (`CUSTOMER_PRICE_CACHE_TTL_MS` = 10 h) | Precio intradía cambia | Sí (estabilidad intradía / `last_updated`) | **Persistir** los `Map` de `pricelistCache`. Solo lectura en picker; venta revalida precio online. |
| **Inventario / carga visible** | Sí (referencial) | Sí (referencial) | Jornada | Sobreventa si se tratara como autoritativo | **Sí (stock guard duro)** | Mostrar como **referencial**; el clamp local NO previene sobregiro — backend debe rechazar (`insufficient_stock`). |
| **Motivos de no venta** | Sí | Ya (en código) | n/a (estático) | Desalineación con catálogo Odoo de motivos | Opcional (mover a endpoint) | **Ya offline** (`NO_SALE_REASONS` hardcoded). Dejar como está; si se quiere server-driven, es 2D backend-opcional. |
| **Reglas de pricelist** | Parcial | Parcial | Jornada | Regla cambia mid-día | Sí (resolución server-side) | Cachear el **resultado** (precio por producto/cliente), no recomputar reglas en cliente. Ya es el patrón de `computeCustomerPrices`. |
| **Consignaciones activas (lectura)** | Sí | **Sí (NUEVO, lectura)** | Jornada / hasta acción | Lista de consignación obsoleta | Parcial (snapshot batch) | Cachear `GET /consignment/my-active` por-partner para **lectura** offline. Crear/cerrar consignación sigue online-first vía cola. |
| **Imágenes de producto** | Sí | Sí (disco/HTTP cache) | Larga (semanas) | Imagen vieja (bajo impacto) | **Sí (`Cache-Control`)** | Prefetch en CEDIS vía `/web/image/.../image_128`; requiere `Cache-Control` del backend para cache HTTP persistente. Placeholder si falta. |
| **Configuración / feature flags** | Sí | Sí | Jornada / al login | Flag viejo | Opcional | Cachear lo mínimo (warehouseId, companyId, mobileLocationId ya en auth). Sin libs nuevas. |

**Mínimo requerido para salir del CEDIS:** `plan` + `stops` + `productos (catálogo)`. Precios e imágenes son *best-effort* (no bloquean salida; degradan a `list_price` / placeholder).

---

## 4. Arquitectura frontend propuesta (sin código)

### 4.1 Servicios / stores

- **`src/services/cacheStore.ts` (NUEVO, pura capa de caché versionado)** — envoltura sobre `storage.ts` que añade **sobre de metadatos** a cada blob:
  ```
  { schemaVersion, cachedAtMs, dayKey, employeeId, planId, payload }
  ```
  API conceptual: `writeCache(key, payload, ctx)`, `readCache(key, ctx, ttlMs)` → devuelve `{ payload, stale }` o `null`. No agrega librerías (usa el AsyncStorage ya presente).
- **`src/services/pricelistCache.ts` (EXTENDER)** — añadir `hydratePricelistCacheFromDisk()` / `persistPricelistCacheToDisk()` que serialicen los `Map` actuales (`partnerPriceCache`, `partnerPricelistIdCache`) a través de `cacheStore`. La lógica de TTL/keys **no cambia** (ya correcta). Disparar persist tras `cacheCustomerPrices` (debounced, como el patrón de `useSyncStore.schedulePersist`).
- **`src/stores/useProductStore.ts` (REFINAR)** — separar **catálogo** (persistible) de **stock autoritativo** (no): persistir id/nombre/código/precio/categoría/peso; marcar `qty_available` como referencial al rehidratar y `inventorySource='cache'`. **Quitar** los `storeRemove(STORAGE_KEYS.PRODUCTS)` incondicionales y reemplazar por escritura de catálogo; al volver online, `loadProducts` refresca y re-marca autoritativo.
- **`src/services/rehydrate.ts` (REFINAR)** — en boot, **rehidratar catálogo desde caché** (línea 113 deja de borrar a ciegas) **siempre que** `dayKey==hoy` y `employeeId==actual`; si no, limpiar. Rehidratar precios vía `hydratePricelistCacheFromDisk`.
- **`src/stores/useRoutePreparationStore.ts` (EXTENDER)** — tras cada paso exitoso, escribir a caché persistente; exponer `minimumReady` (plan+stops+productos en caché) para el gate de salida.

### 4.2 Keys (sobre `STORAGE_KEYS` existente)

Reusar las actuales y añadir:
- `entities:products:catalog` → catálogo persistible (reemplaza el uso efímero de `entities:products`).
- `cache:prices` → dump serializado de los Maps de precios.
- `cache:consignments` → snapshot por-partner de consignación activa (2D).
- `meta:cacheSchemaVersion` → entero de versión de schema.
- `meta:dayKey` → `todayLocalISO()` de la última preparación.

### 4.3 Versionado

- `CACHE_SCHEMA_VERSION` constante en `cacheStore.ts`. Cada blob lleva su `schemaVersion`.
- Al leer: si `blob.schemaVersion !== CACHE_SCHEMA_VERSION` → **descartar** (tratar como cache miss) y limpiar. Bump manual de la constante invalida todo el caché viejo de forma segura (evita leer estructuras incompatibles tras un deploy).

### 4.4 Invalidación

Disparadores de invalidación (descartar y, si online, recargar):
- **Cambio de día:** `dayKey != todayLocalISO()`.
- **Cambio de empleado:** `employeeId != auth.employeeId` (ya se valida para plan en `rehydrate.ts:76`).
- **Cambio de plan/ruta:** `planId != plan actual` (helper `isPreparationFreshForPlan` ya existe).
- **Cierre de ruta:** al cerrar la jornada, limpiar caché de jornada (no la cola de sync).
- **Bump de schema version.**
- **TTL vencido** (ver 4.5).

### 4.5 TTL de jornada

- Precios: `CUSTOMER_PRICE_CACHE_TTL_MS` (10 h) — **ya definido**, reusar.
- Catálogo/stops/plan: TTL = jornada (efectivamente "hasta cambio de día/empleado/plan o cierre"). No usar TTL corto: la lección de Fase 1A fue justamente que TTL corto re-disparaba RPCs que cuelgan en ruta sin señal.

### 4.6 Fallback stale

- `readCache` devuelve `{ payload, stale: true }` cuando el TTL venció **pero hay online dudoso**: la UI puede **mostrar stale + marca visible** ("datos del CEDIS, sin actualizar") mientras intenta refrescar en segundo plano. Mejor stale-marcado que pantalla en blanco. **Nunca** stale para autorizar venta (eso siempre revalida online en backend).

### 4.7 Limpieza

- Al **cerrar ruta** (`route-close`): purgar `entities:products:catalog`, `cache:prices`, `cache:consignments`, `meta:dayKey` (dejar `sync:queue` intacta).
- Al **invalidar por día/empleado/plan distinto**: mismo barrido.
- `storeClear()` ya existe para wipe total (logout duro).

### 4.8 Manejo de datos corruptos

- `cacheStore.readCache` envuelve el `JSON.parse` (ya try/catch en `storage.ts`) y además **valida la forma del sobre** (campos esperados + `schemaVersion`). Cualquier blob malformado → descartar como miss + `storeRemove`. Nunca propagar excepción al boot (el `rehydrate` ya tiene try/catch global).

### 4.9 Cambio de usuario / ruta / día

- Centralizado en `cacheStore`/`rehydrate`: el **contexto** (`employeeId`, `dayKey`, `planId`) viaja en el sobre; cualquier mismatch = invalidar. Esto generaliza el chequeo que hoy existe solo para el plan (`rehydrate.ts:72-106`).

### 4.10 Sin librerías nuevas

No se agregan dependencias. AsyncStorage (ya presente) cubre todo. La nota arquitectónica de `storage.ts` (V2 podría migrar a WatermelonDB) queda **fuera de alcance** — sería sobre-ingeniería para el volumen actual (catálogo ~100–500 productos, decenas de stops).

---

## 5. Contrato backend requerido (para Sebastián)

> Ninguno de estos endpoints se asume existente. El frontend de Fase 2 **funciona sin ellos** (usa los RPC/endpoints actuales por-cliente); estos los hacen **eficientes y robustos**.

| # | Solicitud | Por qué | Tipo |
|---|---|---|---|
| B1 | **Endpoint batch/delta de precios de ruta**: dado `plan_id` (o lista de `partner_id` + `product_ids`), devolver precios de todos los clientes en **una** llamada (idealmente solo lo cambiado desde `since`). | Hoy `prepareRouteData` hace 1 RPC por cliente (pool de 4). En WiFi CEDIS es lento y frágil. | Mejora |
| B2 | **`last_updated` / versión** en catálogo y pricelist. | Permite **delta sync** (no redescargar todo) e invalidación correcta del caché. | Mejora |
| B3 | **Endpoint de preparación de ruta** (opcional): un solo payload con plan + stops + catálogo + precios + consignaciones activas para `plan_id`. | Una sola descarga atómica en el CEDIS en vez de 3+ flujos. | Mejora |
| B4 | **`Cache-Control` en `/web/image/.../image_128`**. | Sin él, las imágenes no se cachean en disco y no hay imágenes offline. | **Necesario para imágenes offline** |
| B5 | **Estabilidad intradía de precios** (confirmar): ¿los precios de lista/pricelist cambian dentro de la jornada? | Define si el TTL de 10 h es seguro o hay que acortarlo / añadir versión. | **Bloqueante de diseño** |
| B6 | **Stock guard duro en `/sales/create`**: rechazar líneas con `quantity > qty_available`. | El caché muestra stock referencial; el backend debe ser la barrera real (ya pedido en `BACKEND_HARDENING_REQUESTS.md §1`). | **Necesario (seguridad)** |
| B7 | **Respuesta detallada de `insufficient_stock`**: por línea, `product_id`, `requested`, `available`. | Para que la app muestre al vendedor exactamente qué quitar/ajustar tras el rechazo backend. | **Necesario (UX del guard)** |
| B8 | **Serialización de consignación** (`create`/`visit`/`close` devuelven `sale_order_id`, folio, `payment_id`, `picking_id`, importe, `sold_qty`). | Para reflejar el resultado real y poder cachear el estado de consignación (ya pedido en `BACKEND_HARDENING_REQUESTS.md §8`). | Mejora |
| B9 | **Estado de sync/cierre** (confirmar): ¿`close-route` y `liquidacion/confirm` son idempotentes por `plan_id`/`operation_id`? | El gate de cierre frontend ya bloquea con pendientes; falta confirmar que el cierre es idempotente ante retry (ya pedido en `BACKEND_HARDENING_REQUESTS.md §4, §5`). | **Bloqueante de cierre** |

**B5, B6, B7, B9 son bloqueantes** para cerrar Fase 2 con estándar enterprise. B1–B3, B8 son optimizaciones que el frontend puede absorber con degradación. B4 es necesario solo para imágenes offline (2D).

---

## 6. Plan por PRs (un PR = una intención)

### PR **2A — Doc / arquitectura** *(este PR)*
- **Alcance:** este documento. Sin código funcional.
- **Archivos:** `docs/KOLDFIELD_PERFORMANCE_FASE2_CEDIS_CACHE_PLAN.md`.
- **Tests:** n/a.
- **Riesgos:** ninguno (doc).
- **Backend:** ninguno (solo lista solicitudes).

### PR **2B — Caché persistente de productos/precios** *(primer PR implementable)*
- **Alcance:** persistir catálogo + precios y rehidratarlos en boot, con versionado/invalidación/limpieza. **Sin cambiar UI ni reglas de venta.** Stock sigue referencial; venta sigue online-first.
- **Archivos probables:** `src/services/cacheStore.ts` (NUEVO), `src/services/pricelistCache.ts` (extender persist/hydrate), `src/stores/useProductStore.ts` (separar catálogo de stock autoritativo; quitar `storeRemove` ciego), `src/services/rehydrate.ts` (rehidratar catálogo+precios con guards de día/empleado/plan), `src/persistence/storage.ts` (nuevas keys + `CACHE_SCHEMA_VERSION`).
- **Tests:** `tests/cacheStore.test.ts` (sobre/versión/TTL/corrupción/invalidación por contexto), `tests/pricelistCachePersistence.test.ts` (round-trip Map↔disco, TTL jornada), extender `tests/pricelistCacheStability.test.ts`. (Todos pure-helper, node test runner.)
- **Riesgos:** rehidratar stock viejo como autoritativo → **mitigado** marcándolo referencial + venta revalida en backend. Corrupción → manejo en `cacheStore`.
- **Backend:** ninguno para la versión base; mejora con B1/B2.

### PR **2C — Pantalla "Preparar ruta" + gate de salida**
- **Alcance:** formalizar la preparación como pantalla/flujo con progreso, faltantes, errores por-partner (reusa `useRoutePreparationStore`) y **gate "Listo para salir"** (mínimo requerido en caché). No re-implementa el orquestador.
- **Archivos probables:** `app/route-prepare.tsx` (NUEVO) o promover `RoutePreparationCard` a pantalla; `src/services/routePreparationLogic.ts` (añadir `minimumReady(...)` puro); enlace desde `app/route-start.tsx`/`app/(tabs)/index.tsx`.
- **Tests:** `tests/routePreparationReadiness.test.ts` (gate de mínimo requerido, puro).
- **Riesgos:** bloquear salida indebidamente → gate solo exige plan+stops+productos; precios/imágenes no bloquean.
- **Backend:** ninguno (mejora con B3).

### PR **2D — Consignaciones (lectura) + imágenes + (opcional) motivos server-driven**
- **Alcance:** cachear `consignment/my-active` para lectura offline; prefetch + cache de imágenes en CEDIS; (opcional) mover `NO_SALE_REASONS` a config cacheada.
- **Archivos probables:** `src/services/consignment.ts` (cache de lectura), nuevo helper de prefetch de imágenes en `useRoutePreparationStore`, `src/services/noSaleReasons.ts` (si server-driven).
- **Tests:** `tests/consignmentCache.test.ts`.
- **Riesgos:** consignación obsoleta en lectura → marca "snapshot CEDIS"; crear/cerrar sigue online. Imágenes dependen de **B4**.
- **Backend:** **B4** (Cache-Control) para imágenes offline; B8 para serialización; B-opcional para motivos.

### PR **2E — Sync al regreso + verificación del bloqueo antes de cierre**
- **Alcance:** asegurar que al recuperar conexión se fuerza `processQueue` (ya en `connectivity.ts`) y que el **gate de cierre** (`cashcloseGuard`) cubre **toda** la ruta de cierre (no solo `cashclose.tsx`): revisar `route-close.tsx` para que no permita cerrar con pendientes/error/dead, y limpiar caché de jornada al cerrar.
- **Archivos probables:** `app/route-close.tsx`, `app/cashclose.tsx` (verificación), `src/services/routeClose.ts`, hook de limpieza de caché.
- **Tests:** extender `tests/` del guard de cierre (caso route-close).
- **Riesgos:** bajo (mayormente verificación + limpieza). Cierre idempotente depende de **B9**.
- **Backend:** **B9** (idempotencia de cierre/liquidación) para cerrar el caso al 100%.

**Orden recomendado:** 2A → **2B** → 2C → 2D → 2E. 2B es el de mayor valor/riesgo-controlado y no depende de backend.

---

## 7. Riesgos

1. **Vender contra stock viejo** (el riesgo central). *Mitigación:* stock cacheado siempre **referencial**; venta online-first; backend valida (B6/B7). El caché nunca autoriza venta.
2. **Precio intradía cambia** y el caché sirve uno viejo en el picker. *Mitigación:* solo lectura; la venta revalida precio en backend. Confirmar B5; si cambian, acortar TTL o usar versión (B2).
3. **Caché corrupto** rompe el boot. *Mitigación:* `cacheStore` valida sobre + schemaVersion; descarta como miss; `rehydrate` tiene try/catch global.
4. **Caché cruzado entre empleados/días/planes** (datos de otro vendedor). *Mitigación:* contexto en el sobre; invalidación por mismatch (generaliza el guard actual del plan).
5. **Crecimiento de AsyncStorage** (catálogo + precios + imágenes). *Mitigación:* limpieza al cierre/cambio de día; imágenes vía cache HTTP, no en AsyncStorage.
6. **Deuda de migración de schema** entre deploys. *Mitigación:* `CACHE_SCHEMA_VERSION`; bump invalida lo viejo.
7. **Falsa sensación de "offline completo".** El caché es lectura; operaciones críticas siguen necesitando red (con cola). Comunicar con badges claros ("stock referencial", "snapshot CEDIS", "sin conexión").
8. **Cierre medio-hecho** ante retry sin idempotencia backend (B9). *Mitigación:* gate frontend ya bloquea con pendientes; falta confirmación backend.

---

## 8. Preguntas para Sebastián

1. **(B5, bloqueante)** ¿Los precios de lista/pricelist cambian **dentro** de la jornada? Si sí, ¿con qué frecuencia? → define TTL/versión.
2. **(B6/B7)** ¿`/sales/create` ya rechaza `quantity > qty_available`? ¿La respuesta de `insufficient_stock` trae detalle por línea (`product_id`, `requested`, `available`)?
3. **(B2)** ¿Existe `last_updated`/versión en catálogo y pricelist para hacer **delta** y no redescargar todo?
4. **(B1/B3)** ¿Viable un endpoint **batch** de precios por `plan_id` (y/o un endpoint único de "preparación de ruta")? Hoy hacemos 1 RPC por cliente.
5. **(B4)** ¿Podemos poner `Cache-Control` en `/web/image/product.product/<id>/image_128` para cache de imágenes offline?
6. **(B9)** ¿`close-route` y `liquidacion/confirm` son **idempotentes** por `plan_id`/`operation_id`? (Ver `BACKEND_HARDENING_REQUESTS.md §4, §5`.)
7. **(B8)** ¿Consignación `my-active` puede entregar snapshot batch por ruta para cachear lectura offline?
8. ¿Los **motivos de no venta** deben venir del servidor (catálogo Odoo) o se quedan hardcoded en la app? (Hoy hardcoded; ya offline.)

---

## 9. Primer PR implementable recomendado

**PR 2B — Caché persistente de productos/precios.**

- **Por qué primero:** resuelve el problema #1 reportado (precios/productos se pierden al reiniciar) con **máximo valor** y **sin depender de backend**. Es la base sobre la que se apoyan 2C/2D.
- **Es frontend-only:** usa `loadProducts`/`computeCustomerPrices` ya existentes; solo añade persistencia, versionado e invalidación.
- **Seguridad preservada:** stock cacheado queda **referencial** y marcado; la venta sigue online-first y el backend valida. No habilita venta offline.
- **Entregable verificable:** tests puros de `cacheStore` (sobre/versión/TTL/corrupción/contexto) + round-trip de precios; typecheck limpio; sin libs nuevas.

---

### Anexo — Frontend-only vs Backend-required (resumen)

| Capacidad | Frontend-only | Requiere backend |
|---|---|---|
| Persistir catálogo + precios y rehidratar (2B) | ✅ | — |
| Versionado / invalidación / limpieza / corrupción (2B) | ✅ | — |
| Pantalla Preparar ruta + gate de salida (2C) | ✅ | mejora con B3 |
| Gate de cierre con pendientes (2E) | ✅ (ya existe) | idempotencia = B9 |
| Lectura offline de consignación (2D) | ✅ (cache por-partner) | mejora con B8/B3 |
| Imágenes offline (2D) | parcial (prefetch) | **B4 (Cache-Control)** |
| Stock no-sobreventa real | ❌ | **B6/B7** |
| Descarga eficiente batch/delta | ❌ | **B1/B2** |
| TTL de precios seguro | depende | **B5 (confirmar)** |
