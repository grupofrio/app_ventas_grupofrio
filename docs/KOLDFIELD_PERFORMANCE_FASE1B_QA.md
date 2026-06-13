# KoldField — QA Performance Fase 1B (Runtime bajo perfil)

**Rama:** `feat/koldfield-perf-fase1b-runtime`
**Alcance:** 3 mejoras de runtime. **Sin backend, sin contratos API, sin deps, sin rediseño de sync, sin caché persistente CEDIS.**

## Cambios
1. **Timeout offline-aware en LECTURAS** (`src/services/api.ts`): nuevo `DEFAULT_READ_TIMEOUT_MS = 10_000`; `getRest` usa 10 s por defecto en vez de 45 s. Las **mutaciones** (`postRest`/`postRpc`: venta, pago, cierre, liquidación) conservan 45 s conservadores. El timeout sigue lanzando (no oculta errores); el llamador usa caché/fallback. Las firmas no cambian (los llamadores pueden pasar `timeoutMs`).
2. **Batch/throttle de `persistQueue`** (`src/stores/useSyncStore.ts` + nuevo `src/services/syncQueuePersistence.ts`): las transiciones de estado (`markDone`/`markError`/`markDead`/`clearDone`/`clearDead`) ya **no reescriben** el JSON completo de la cola por mutación; usan `schedulePersist()` (debounce trailing 800 ms, coalesce de ráfaga). `enqueue` sigue persistiendo **inmediato** (durabilidad de la operación) y el **post-ciclo** persiste **inmediato** (1 write con todo el resultado y cancela el timer pendiente). Un ciclo de 200 ítems pasa de ~200 writes a ~2-3.
3. **Timer de visita eficiente** (`src/stores/useVisitStore.ts` + `shouldPersistVisitTick` en `visitPersistence.ts`): el contador visible sigue actualizándose **cada segundo en memoria**, pero el snapshot a AsyncStorage solo se persiste **cada 20 s** (no cada segundo). El `elapsed` se recomputa de `checkInTime` al rehidratar, así que no se pierde duración relevante. Eventos clave (iniciar visita, fase, checkout) siguen persistiendo aparte.

## No pierde operaciones (clave de seguridad)
- Las **operaciones** se persisten inmediato al `enqueue`. El debounce solo afecta **banderas de estado** (done/error/dead), recuperables: al rehidratar, `syncing→pending` y la idempotencia por `operation_id` hace seguro el reintento. Peor caso (app muere en la ventana de 800 ms): se re-intenta una operación ya persistida; el backend deduplica.
- `selectPersistableQueue` garantiza que `pending/error/dead/syncing` nunca se descartan (solo `done`).

## Pruebas manuales
- [ ] **App con red lenta:** abrir Home/Ruta no cuelga 45 s en lecturas; cae a ~10 s y usa caché.
- [ ] **ProductPicker sin red:** abre con precios de la jornada (Fase 1A) y NO espera 45 s (lecturas a 10 s).
- [ ] **Cola con muchas operaciones:** hacer varias ventas/checkins seguidos; verificar que sincroniza y la UI de sync refleja el estado (puede actualizar el contador con ~1 s de retraso por el debounce, sin perder items).
- [ ] **Cerrar/reabrir app con cola pendiente:** las operaciones encoladas siguen ahí tras reabrir (persistidas en enqueue); reintentan y el backend deduplica.
- [ ] **Visita larga (10+ min):** el contador avanza fluido cada segundo; al cerrar/reabrir la duración es correcta (recomputada de checkInTime).
- [ ] **Checkout tras visita:** la duración registrada es correcta.
- [ ] **Regreso a CEDIS y sync:** `processQueue` vacía la cola; `cashcloseGuard` sigue bloqueando liquidación con pendientes/errores.
- [ ] **Venta sigue online-first:** confirmar sin red muestra "Venta requiere conexión" (regla intacta).

## Validación
- `npm run typecheck` → **limpio (exit 0)**.
- `npm test` → **111/111** (nuevo `perfFase1bRuntime`: selectPersistableQueue no pierde items + shouldPersistVisitTick cada 20 s).

## Riesgos abiertos
- Debounce de 800 ms en transiciones de estado: si la app muere en esa ventana, una operación ya persistida puede reintentarse (idempotencia backend lo cubre). No hay pérdida de operaciones.
- No se agregó flush en background (AppState) — fuera de alcance; el bound de 800 ms + enqueue-inmediato lo hace seguro.
- Timeout de lecturas a 10 s: en redes muy lentas (no muertas) una lectura legítima >10 s fallará y usará caché; aceptable para gama baja.

## Fuera de alcance (no tocado)
Boot paralelo, GPS timeout/frecuencia, selectors de stores, persistencia de caché CEDIS (Fase 2), rediseño de sync queue, imágenes, telemetría, backend/contratos, reglas de negocio de venta.
