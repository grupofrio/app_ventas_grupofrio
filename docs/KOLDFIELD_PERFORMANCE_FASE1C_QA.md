# KoldField — QA Performance Fase 1C (Render + Boot)

**Rama:** `feat/koldfield-perf-fase1c-render-boot`
**Alcance:** render/boot frontend. **Sin backend, sin contratos, sin rediseño de sync, sin caché CEDIS persistente, sin UX vendedor rápido, sin deps.**

## Cambios
1. **Selectors de stores** (route, home, sale, checkout): se reemplazó el `useStore()` con destructuring completo por **selectors por campo** (`useStore((s) => s.x)`). Antes cualquier cambio del store re-renderizaba la pantalla; en `sale`/`checkout` eso incluía el **tick de 1 s** del timer de visita aunque no se mostrara. Misma lógica, menos renders.
2. **Boot paralelo + GPS init con timeout** (`_layout.tsx`, `gps.ts`): `ensureEmployeeAnalytics()` + `rehydrateAppState()` ahora en `Promise.all` (independientes). GPS init ya iba `void` (no bloquea UI); además `initializeGPS` usa `Promise.race` con `GPS_INIT_TIMEOUT_MS = 5s` → si el GPS tarda, no se cuelga ni inyecta `0,0`: queda en estado claro y check-in/watch reintentan (cada uno con su propio timeout de 8 s).
3. **Guard de fetch-on-focus** (`route.tsx`, `home`): `loadPlan` ya deduplicaba concurrencia (`if (isLoading) return`); se añadió `shouldRefetchOnFocus(lastSync, now, 8s)` para **no re-pedir el plan** al recuperar foco si se cargó hace <8 s (volver de un cliente). `loadTodaySales` queda con su in-flight guard; el **pull-to-refresh (force)** no usa el guard y siempre recarga.
4. **ProductPicker renderItem** (`ProductPicker.tsx`): `handleSelect`, `renderListItem` y `renderGridItem` envueltos en `useCallback` → menos recreación de filas en re-renders que no cambian `quantities`/handlers. El debounce de Fase 1A se mantiene.
5. **Logs HTTP**: `src/utils/httpDebug.ts` **ya trunca** (string 240 chars, arrays 10, objetos 25, depth 4) y **redacta** headers/keys sensibles (token/password/api-key/cookie) y binarios (base64/photo). **Verificado — sin cambios necesarios.**

## Pruebas manuales
- [ ] **Arranque en red lenta:** la app llega a Home/Login sin colgarse esperando GPS (init no bloquea; cae a 5 s).
- [ ] **GPS lento / sin permiso:** no se cuelga; sin coords falsas `0,0`; check-in obtiene ubicación con su propio timeout.
- [ ] **Home/Ruta sin fetch duplicado:** abrir cliente y volver rápido NO re-dispara `loadPlan` (si <8 s); el contador de progreso/stats se mantiene; pull-to-refresh sí recarga.
- [ ] **ProductPicker con búsqueda:** escribir filtra con debounce (1A); seleccionar producto y ajustar cantidades funciona igual; scroll fluido.
- [ ] **Venta/checkout:** el cronómetro de visita avanza en checkout; la pantalla de venta ya no re-renderiza por el tick; confirmar venta sigue online-first.
- [ ] **Checkout sin coords falsas:** navegar al siguiente cliente usa la ubicación real o `null` (nunca `0,0`) — cubierto por el fix de checkout y por GPS sin `0,0`.
- [ ] **Logs con payload largo:** los logs muestran `[TRUNCATED N chars]`/`[REDACTED]`, no el payload completo ni tokens.

## Validación
- `npm run typecheck` → **limpio (exit 0)**.
- `npm test` → ver resultado (nuevo `focusRefresh`).

## Riesgos abiertos
- Guard de focus 8 s: en el peor caso, datos hasta 8 s "viejos" al volver muy rápido; el sync en segundo plano y el pull-to-refresh los actualizan. Sin staleness relevante.
- `ProductPicker`: la estabilización completa de filas requeriría memoizar `existingProductIds` (prop, identidad nueva por render en las pantallas) y extraer un `Row`/`ProductImage` memoizado → **refactor mayor, fuera de 1C**. La virtualización de 1A ya acota el costo.
- GPS init 5 s: en arranque con señal muy débil, el primer fix puede no estar listo; check-in lo resuelve.

## Fuera de alcance (no tocado)
Caché persistente CEDIS (Fase 2), rediseño de sync, imágenes, telemetría, UX vendedor rápido, backend/contratos, reglas de negocio.
