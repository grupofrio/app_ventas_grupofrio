# KoldField — QA Performance Fase 2E (Sync al regreso + cierre + limpieza)

**Rama:** `feat/koldfield-perf-fase2e-sync-cleanup-close-gate`
**Base:** `main` @ `7a8947a` (Fase 2D-1 #34 mergeada).
**Alcance:** cerrar el ciclo CEDIS → ruta → regreso: (1) verificar/asegurar `processQueue` al reconectar, (2) **gate de cierre** en `route-close.tsx` si hay operaciones sin sincronizar, (3) **limpieza del caché de jornada** tras cierre exitoso. **Sin backend, sin contratos API, sin imágenes, sin motivos no-venta server-driven, sin deps nuevas, sin cambiar reglas de venta/cobro.**

> **Regla rectora:** el cierre de ruta **no** debe ocurrir con ventas/cobros sin sincronizar (corte fantasma). El **backend es la fuente de verdad**. La limpieza de caché **nunca** toca la cola de sync ni datos de auditoría, y **solo** ocurre si el cierre fue exitoso.

## Cambios
1. **Reconexión → sync (verificado + endurecido)** — `connectivity.ts` ya disparaba `processQueue` al volver online. Se extrajo la decisión a un helper PURO `connectivitySync.shouldProcessOnReconnect(wasOnline, isNowOnline)` (solo flanco offline→online) y se usa en el listener. Doble protección: `useSyncStore.processQueue` ya tiene guard `if (!isOnline || isSyncing) return` → **no hay disparos múltiples ni loops**. (No se cambió el formato de la cola.)
2. **Gate de cierre en `route-close.tsx`** — `routeCloseGuard.ts` (PURO): `hasUnsyncedWork`/`canCloseRoute`/`describeCloseSyncBlock` sobre `{pendingCount,errorCount,deadCount,isSyncing}` de `useSyncStore`. Si hay pendientes/error/dead o sync en curso: botón "Cerrar ruta" **deshabilitado** + banner "⚠️ Sincroniza operaciones pendientes antes de cerrar ruta (…)" + botón **"Ir a sincronizar"** (→ `/cashclose`). El handler también bloquea (belt-and-suspenders). **No** bloquea por lecturas cacheadas (catálogo/precios/consignación).
3. **Limpieza de jornada tras cierre exitoso** — en el `onPress` de cierre, **solo** tras `closeRoute` OK (`shouldCleanupJornadaCache(true)`): `clearPersistedPriceCache()` + `clearPersistedCatalog()` (NUEVO en offlineCache) + `clearCachedConsignments()` + `resetPreparation()`. Si el cierre **falla** (catch), **no** se limpia nada. **No** se toca la cola de sync (ya vacía por el gate).

## Pruebas manuales
- [ ] **Operar sin red:** generar ventas/visitas offline → quedan en cola (pending).
- [ ] **Recuperar conexión:** al volver online, la cola se procesa automáticamente **una sola vez** (no loops); el contador de pendientes baja.
- [ ] **Intentar cerrar con pendientes:** en "Cerrar ruta", el botón está **deshabilitado** con banner y conteo; "Ir a sincronizar" abre Corte de Caja.
- [ ] **Resolver y volver:** sincronizadas todas (cola limpia), el botón "Cerrar ruta" se habilita.
- [ ] **Cerrar ruta exitosamente:** con KM final + cola limpia + online → cierra; mensaje del servidor.
- [ ] **Verificar limpieza:** tras cierre OK, el caché de jornada (catálogo/precios/consignaciones) queda limpio; la preparación se resetea. La cola de sync (vacía) **no** se altera.
- [ ] **Cierre fallido no limpia:** si `closeRoute` falla (corte/liquidación incompletos), el caché **permanece** (no se borró nada).
- [ ] **Abrir app al día siguiente:** sin caché de ayer (también invalidado por contextKey de día); preparar ruta de nuevo.
- [ ] **No bloquear por caché:** tener consignación/catálogo cacheado NO impide cerrar si la cola está limpia.

## Pruebas automáticas (puras, node)
- `tests/routeCloseGuard.test.ts`:
  - **reconexión dispara sync una sola vez** (`shouldProcessOnReconnect`: solo flanco offline→online);
  - **route-close bloquea** con pending/error/dead/syncing (`canCloseRoute=false`, mensaje claro);
  - **route-close permite** con cola limpia (`canCloseRoute=true`, sin mensaje);
  - **limpieza solo tras cierre exitoso** (`shouldCleanupJornadaCache(true/false)`).

## Validación
- `npm run typecheck` → **limpio (exit 0)**.
- `npm test` → **118/118**.

## Riesgos abiertos
- **Idempotencia de cierre/liquidación = backend (B9):** el gate frontend evita cerrar con pendientes, pero la idempotencia ante retry de `close-route`/`liquidacion-confirm` depende de Sebas (ver `KOLDFIELD_BACKEND_HARDENING_REQUESTS.md` §4/§5).
- **Gate por conteos visibles de la cola:** usa `pendingCount/errorCount/deadCount` (items user-visibles). Coherente con `cashcloseGuard` de liquidación.
- **Limpieza es best-effort (fire-and-forget):** si un `storeRemove` fallara, la invalidación por contextKey de día/usuario igual evita usar datos de ayer; no es crítico.
- **Sync al reconectar** depende de `@react-native-community/netinfo` (sin cambios); el helper puro solo decide el flanco.

## Fuera de alcance (no tocado)
Imágenes (2D-2), motivos no-venta server-driven, backend/contratos, reglas de venta/cobro, formato de la cola de sync, deps nuevas.
