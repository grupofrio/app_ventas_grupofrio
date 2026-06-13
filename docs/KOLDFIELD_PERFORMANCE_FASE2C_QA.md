# KoldField — QA Performance Fase 2C (Preparar ruta + gate + badge)

**Rama:** `feat/koldfield-perf-fase2c-preparar-ruta`
**Base:** `main` @ `1a112e3` (Fase 2B #32 mergeada).
**Alcance:** formalizar la **preparación de ruta** en el hub de inicio (CEDIS), añadir un **gate de salida** (no iniciar ruta sin el mínimo de datos en caché) y un **badge** de datos en caché / sin conexión en pantallas críticas. **Sin backend, sin contratos API, sin reglas de venta, sin sync-de-regreso (2E), sin imágenes/consignaciones (2D), sin deps nuevas, sin refactors grandes.**

> **Regla rectora:** la venta sigue **online-first**; el **backend valida stock/precio al confirmar**. El gate y el badge son de **preparación y visibilidad**, no habilitan venta offline. El gate **nunca inventa datos** y **no** bloquea una operación ya iniciada en ruta.

## Cambios
1. **Gate de readiness (puro)** — `src/services/routeReadiness.ts`: `computeRouteReadiness` decide bloques `route`/`products`/`prices`. **Mínimo bloqueante = ruta + productos**; precios faltantes/parciales = **advertencia** (degradación segura: el picker cae a `list_price`, la venta revalida online). `blockReason`/`warnings` para UI.
2. **Estado de datos (puro)** — `src/services/cacheStatus.ts`: `describeCacheStatus` traduce `fromCache`/`cachedAtMs` (metadata 2B) + conectividad en `Sin conexión` / `Datos de la mañana` / `Usando caché` / (oculto si online+fresco). `formatAgo` seguro ante null/futuro.
3. **Badge** — `src/components/ui/CacheStatusBadge.tsx`: pill discreto que lee `useProductStore`+`useSyncStore` y usa el helper. Montado en **pantalla de Ruta** (`app/(tabs)/route.tsx`) y **ProductPicker** (`src/components/domain/ProductPicker.tsx`). Se oculta solo cuando hay conexión y datos frescos.
4. **Hub de inicio** — `app/route-start.tsx`: nuevo **paso "5 · Preparar datos de ruta"** que reusa `RoutePreparationCard` (progreso/faltantes/errores por-cliente/reintentar, ya existente). El gate **"Iniciar ruta"** ahora exige también `dataMinReady` (ruta + productos); muestra advertencia si precios incompletos y `blockReason` si falta el mínimo. Resumen incluye `· Datos`.

## Pruebas manuales
- [ ] **Preparar ruta con WiFi (CEDIS):** en "Iniciar operación", paso 5 → "Preparar ruta"; progreso X/Y clientes; al terminar muestra "Ruta lista para salir" + hora.
- [ ] **Gate habilita salida:** con checklist+KM+carga+datos listos, "Iniciar ruta" se habilita; el resumen muestra `✓ Datos`.
- [ ] **Faltan productos:** sin catálogo cargado, "Iniciar ruta" queda **bloqueado** con mensaje "Faltan productos…". No inventa datos.
- [ ] **Precios incompletos:** con productos pero precios parciales, "Iniciar ruta" **se habilita** (no bloquea) y muestra advertencia "precios incompletos… se completan al abrir cada cliente con señal".
- [ ] **Cerrar/reabrir app:** tras preparar, matar app y reabrir → catálogo/precios siguen (2B); el badge refleja caché.
- [ ] **Abrir sin red:** en Ruta y ProductPicker aparece badge **"Sin conexión"** (warn); la lectura funciona desde caché.
- [ ] **Ver badge cacheado:** online con datos rehidratados de la mañana → **"Datos de la mañana · Actualizado hace X h"**; reciente → **"Usando caché"**; online tras refresh fresco → badge oculto.
- [ ] **Reintentar preparación:** si hay clientes con error, "Reintentar pendientes" los recupera (store existente).
- [ ] **Venta sigue online-first:** confirmar venta con red funciona igual; el gate/badge no alteran el flujo de venta.
- [ ] **Celular chico:** layout legible; badge no desborda (numberOfLines=1).

## Pruebas automáticas (puras, node)
- `tests/routeReadiness.test.ts` — preparación completa habilita salida; faltan productos/ruta → bloqueo; precios parciales/ausentes → mínimo listo + advertencia; sin clientes → precios ok.
- `tests/cacheStatus.test.ts` — badge oculto online+fresco; "Sin conexión" offline; "Usando caché"/"Datos de la mañana"; `formatAgo` seguro (null/futuro/min/h/días).
- (Lectura desde caché válido: cubierta por 2B `persistentCache`/`priceCachePersistence`/`productCachePersistent`.)

## Validación
- `npm run typecheck` → **limpio (exit 0)**.
- `npm test` → **116/116**.

## Riesgos abiertos
- **Gate solo en el hub de inicio:** correcto por diseño — no bloquea operación ya en ruta; si el vendedor salta el hub (no debería), no hay segundo gate. Aceptable para 2C.
- **Badge basado en `fromCache` global del product store:** refleja el origen del catálogo, no por-cliente; suficiente para señal de "estás en caché".
- **Precios parciales como advertencia:** un cliente sin precio precargado verá `list_price` hasta abrirlo con señal; la venta revalida en backend (depende de estabilidad intradía — B5 Sebas).
- **Hora "de la mañana" heurística (≥3 h):** etiqueta informativa, no decisión operativa.

## Fuera de alcance (no tocado)
Sync de regreso + limpieza al cierre (2E), consignaciones-lectura/imágenes (2D), backend/contratos, reglas de venta, deps nuevas, refactors grandes.
