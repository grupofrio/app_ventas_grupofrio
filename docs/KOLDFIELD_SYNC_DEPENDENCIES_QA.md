# KoldField — QA: dependencias de sincronización (foto huérfana)

**Rama:** `fix/koldfield-sync-dependent-photos` · **Base:** `main` @ `d071959`
**Fix:** BLD-20260617-DEAD-CASCADE — evita que una foto (u otro dependiente) quede `pending` eterna cuando su venta padre muere (`dead`).

## Causa raíz

Un pedido offline encola `sale_order` y la foto de entrega con `dependsOn:[saleId]` (`app/sale/[stopId].tsx`). El gate `areSyncDependenciesSatisfied` solo libera al dependiente cuando el padre llega a `done` (`src/services/syncDependencies.ts`). Si la venta agota reintentos o recibe un rechazo no-reintentable, pasa a `dead` vía `markDead` — **que antes no cascadeaba**. Resultado:

1. La foto quedaba `pending` **para siempre** (su padre `dead` nunca es `done`).
2. `computeCounts` la contaba en `pendingCount` (la foto es user-visible; solo `gps` se excluye) → **bloqueaba cashclose y route-close**.
3. `clearDead` solo borra items `dead`, no la foto `pending` → **sin escape en UI** y el mensaje de bloqueo apuntaba a la causa equivocada ("operaciones pendientes" en vez de "una venta falló").

## Diagnóstico (respuestas)

1. **¿Cómo se modela una foto dependiente?** Item `type:'photo'`, `priority:2`, con `dependsOn:[saleOperationId]`. El operation_id es el id de la cola (idempotente).
2. **¿Qué pasa si la venta padre pasa a `dead`?** Antes: nada en los dependientes. Ahora: cascada (ver abajo).
3. **¿Por qué la foto quedaba pending?** `areSyncDependenciesSatisfied` y el DAG exigen `dep.status==='done'`; un padre `dead` nunca satisface, así que `processOneItem` la salta indefinidamente; nunca sale de `pending`.
4. **¿Qué bloquea cashclose/route-close?** `pendingCount + errorCount + deadCount > 0` (`cashcloseGuard.canConfirmLiquidation`, `routeCloseGuard.canCloseRoute`). La foto `pending` inflaba `pendingCount`.
5. **¿Existía UI para limpiar/reintentar el grupo?** No para una foto `pending`: `clearDead` solo toca `dead`; el retry de checkout (`rearmSaleOrderForRetry`) solo tocaba la venta. La foto solo se liberaba si la venta finalmente tenía éxito.

## Solución (menor cambio, sin estado nuevo)

Reutiliza el estado `dead` existente (no se agrega `blocked_by_parent` para no propagar el cambio por todo el state machine, badges y guards).

- **`syncDependencies.ts`** (helpers puros):
  - `findLiveDependents(parentId, queue)` — ids de dependientes directos vivos (`pending|syncing|error`).
  - `cascadeDeadToDependents(queue, deadParentId)` — devuelve cola nueva con esos dependientes en `dead`, mensaje claro y `next_retry_at=null`. Pura, no muta; items sin relación se devuelven por referencia.
  - `dependencyBlockedMessage(type)` — "Foto no enviada porque la venta falló" / genérico.
- **`useSyncStore.markDead`** — tras marcar `dead` al padre, aplica `cascadeDeadToDependents`. Loguea `dead_cascade {parent, dependents}`. Trazable, **no borra nada en silencio**.
- **`saleRetry.rearmSaleOrderForRetry`** — al reintentar la venta, también rearma a `pending` sus dependientes `dead` (la foto), preservando `dependsOn` (sigue esperando que la venta llegue a `done`). No duplica items.
- **`sync.tsx`** — un dependiente `dead` con `dependsOn` se muestra con línea roja "⚠ Foto no enviada porque la venta falló. Reintenta la venta o limpia el historial", no como pendiente normal; el hint de la sección "FALLIDOS PERMANENTEMENTE" explica que se limpian padre + dependientes juntos.

## Garantías

| Aspecto | Antes | Ahora |
|---|---|---|
| Foto con padre `dead` | `pending` eterna | `dead` con causa clara |
| `clearDead` | borra solo la venta `dead` | borra venta + foto (ambas `dead`) |
| Bloqueo cashclose/route-close | sí, por foto pending fantasma | sí mientras haya `dead` real; se resuelve con clearDead o retry |
| Retry de la venta | foto seguía sin subir | foto rearmada a `pending`, sube tras `done` de la venta |
| Venta marcada confirmada offline | no | no (intacto) |
| gift / gps / no_sale normales | — | sin cambios (cascada solo si su padre muere) |
| Contrato API | — | sin cambios |

## Caso principal (paso a paso)

1. Modo avión → cliente → venta con productos + foto → "Guardar pedido pendiente". Cola: `sale_order`(pending) + `photo`(pending, dependsOn).
2. Reconectar. La venta es **rechazada de forma repetible** (p.ej. stock insuficiente sin #116) → 3 reintentos → `sale_order` = `dead`.
3. **Cascada:** la `photo` pasa a `dead` automáticamente con "Foto no enviada porque la venta falló".
4. **Sync:** sección "FALLIDOS PERMANENTEMENTE" muestra la venta (🧾 Venta con error) y la foto (📸) con línea roja explicando la dependencia. La foto **ya no aparece como pendiente**.
5. **Cierre/Liquidación:** siguen bloqueados (hay `dead`), pero el mensaje apunta a la causa real (venta con error). Dos salidas:
   - **Reintentar la venta** desde su visita (checkout) → venta y foto vuelven a `pending`; al sincronizar OK, ambas → `done`; bloqueo se levanta.
   - **Limpiar Historial de Errores** en Sync → borra venta **y** foto juntas (ambas `dead`) → `pendingCount/deadCount` a 0 → cierre/liquidación habilitados.
6. **Sin foto huérfana** en ningún caso.

## Pruebas automáticas (node)

- `tests/syncDependencies.test.ts` — gate de dependencia (incl. padre `dead` no satisface, padre ausente sí), `findLiveDependents`, `cascadeDeadToDependents` (cascada de foto, no toca done/gps/gift/no_sale, pureza), mensajes.
- `tests/saleRetry.test.ts` — rearm de venta + dependientes `dead` (sin duplicar, dependsOn preservado), no toca dependientes de otra venta ni dependientes `pending`.
- Cobertura existente sin cambios: `cashcloseGuard`/`routeCloseGuard` (bloqueo por pending/error/dead), `getSaleSyncState`, `pendingOrders`.
- **typecheck limpio; tests 125/125.**

## Riesgos / pendientes

- La cascada es de **dependientes directos** (las fotos dependen directamente de la venta; suficiente para el caso). Cadenas transitivas (A→B→padre) no se cascadean (no existen hoy).
- La sobreventa que provoca el `dead` se sigue detectando solo al sincronizar (modelo S1); la barrera dura depende de **#116** (backend, staging). Este fix mitiga el **síntoma de bloqueo**, no la causa de la venta rechazada.
- Reintentar la venta reusa el mismo `operation_id` (idempotente): no duplica venta ni foto.
