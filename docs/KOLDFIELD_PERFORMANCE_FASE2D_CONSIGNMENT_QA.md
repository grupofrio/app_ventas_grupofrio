# KoldField — QA Performance Fase 2D-1 (Consignaciones: lectura cacheada)

**Rama:** `feat/koldfield-perf-fase2d-consignment-read-cache`
**Base:** `main` @ `f216cf3` (Fase 2C #33 mergeada).
**Alcance:** cachear la **consignación activa** de un cliente para poder **verla en modo lectura sin red**. **No** habilita crear/visitar/cerrar offline. **Sin backend, sin contratos API, sin imágenes (2D-2), sin motivos no-venta server-driven, sin sync-de-regreso (2E), sin deps nuevas.**

> **Regla rectora:** el caché de consignación es **solo lectura**. `create`/`visit`/`close` siguen **online-first**; el **backend es la fuente de verdad** (inventario, cobro, resurtido, devolución, cierre). El caché **nunca** se presenta como tiempo real.

## Decisión de llenado (degradación documentada)
El endpoint `GET /pwa-ruta/consignment/my-active` es **por cliente**. Precargar las N consignaciones de la ruta en la preparación duplicaría RPCs y la mayoría de clientes **no** tiene consignación (respuesta null). Por eso 2D-1 usa **read-through al primer acceso online**: al abrir la pantalla de consignación de un cliente **con señal**, la respuesta se guarda en caché. Así, al reabrir ese cliente **sin señal** (o si el GET falla), se muestra la consignación cacheada. La **precarga masiva** queda para **2D-2**, si el backend expone un endpoint batch (ver `KOLDFIELD_PERFORMANCE_FASE2_CEDIS_CACHE_PLAN.md` §5, B3/B8). No se inventan endpoints.

## Cambios
1. **Lógica pura** — `src/services/consignmentCacheLogic.ts` (RN-free, node-testable): `buildConsignmentsContextKey` (día/empleado/empresa), `selectConsignment`, `upsertConsignment` (inmutable), `canMutateConsignment(isOnline)`, `CONSIGNMENT_CACHE_TTL_MS`.
2. **Wiring de disco** — `src/services/consignmentCache.ts`: usa el sobre versionado de 2B (`persistentCache`) + `STORAGE_KEYS.CONSIGNMENTS`. `readCachedConsignment`/`writeCachedConsignment` (read-modify-write del mapa partner→consignación), `clearCachedConsignments` (para 2E). Invalida por contexto/TTL; corrupto/stale → limpia y no usa.
3. **Pantalla** — `app/consignment/[stopId].tsx`:
   - online OK → muestra datos frescos y **guarda en caché** (read-through);
   - offline / error de lectura con caché válida → muestra **modo lectura cacheada** con banner **"📦 Consignación desde caché"**;
   - el guard de "Requiere conexión" ahora solo aplica **si no hay caché** (offline + sin caché);
   - **botones de visita/cierre deshabilitados** sin conexión (`canMutateConsignment`), con nota; create también bloqueado offline (sin caché → ni se llega).

## Pruebas manuales
- [ ] **Preparar ruta / abrir cliente con red:** abrir un cliente con consignación activa → se ve normal; se cachea (read-through).
- [ ] **Cerrar app y reabrir SIN red, mismo cliente:** se muestra la consignación en **modo lectura** con banner "desde caché · sin conexión".
- [ ] **create/visit/close offline bloqueados:** sin red, "Registrar visita" y "Confirmar cierre" están **deshabilitados**; create no es accesible (sin caché → pantalla "Requiere conexión").
- [ ] **Cliente sin consignación + offline + sin caché:** pantalla "Requiere conexión" con guía de abrir con señal.
- [ ] **Reconectar y refrescar:** con red, "Reintentar"/reentrar actualiza datos y re-cachea; el banner desaparece.
- [ ] **No tiempo real:** el banner deja claro que es lectura; los importes "preliminar" siguen rotulados "el servidor confirma".
- [ ] **Cambio de día / vendedor:** la consignación cacheada de ayer/otro empleado **no** se muestra (contextKey distinto).

## Pruebas automáticas (puras, node)
- `tests/consignmentCache.test.ts`:
  - cache válido **rehidrata** la consignación del cliente (round-trip por el sobre);
  - cache **stale** (TTL vencido) → no se usa;
  - cache **corrupto** → `selectConsignment` null sin crash; `readCacheEnvelope` miss;
  - **create/visit/close offline bloqueados** (`canMutateConsignment(false)=false`);
  - contextKey distingue **día/usuario**; `upsertConsignment` inmutable y elimina con null.

## Validación
- `npm run typecheck` → **limpio (exit 0)**.
- `npm test` → **117/117**.

## Riesgos abiertos
- **Lectura potencialmente desfasada:** la consignación cacheada puede no reflejar movimientos hechos desde otro dispositivo; por eso es **solo lectura** y toda mutación exige red (backend recalcula). Banner explícito.
- **Read-through (no precarga):** un cliente nunca abierto con señal no tendrá caché offline. Aceptado por diseño (volumen/RPCs); 2D-2 con endpoint batch lo resolvería.
- **Existencia física no se cachea como editable:** el conteo (`physical`) es entrada del momento; offline no se puede enviar (correcto).
- **Limpieza al cierre de ruta:** `clearCachedConsignments` existe pero se **invoca en 2E** (limpieza de jornada). La invalidación por contexto/TTL ya evita datos cruzados de día/usuario.

## Fuera de alcance (no tocado)
Imágenes (2D-2), motivos no-venta server-driven, precarga batch de consignaciones, sync de regreso + limpieza al cierre (2E), backend/contratos, reglas de venta, deps nuevas.
