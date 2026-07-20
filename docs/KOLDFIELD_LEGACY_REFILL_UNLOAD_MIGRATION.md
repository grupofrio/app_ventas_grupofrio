# Migración de compatibilidad: eventos legacy refill/unload

Compat por **una versión**. El flujo antiguo (solicitar recarga / pantalla de
descarga) se retiró: la recarga la crea Almacén y el vendedor la ACEPTA; la
devolución (vendible + merma) se captura en el Corte. Este documento describe el
**orden durable** y el **contrato de refresh autoritativo** de la migración.

## Objetivo de seguridad

> Nunca perder la necesidad de un refresh autoritativo de inventario, aunque la
> app cierre a mitad o AsyncStorage falle. Un evento legacy jamás debe
> desaparecer sin dejar una reparación pendiente durable.

## Orden durable del retiro de un evento legacy

Único helper compartido por el rehidratado y el guard del dispatcher
(`useSyncStore.durableMigrateLegacy` → `runDurableLegacyMigration`):

1. **Persistir `LEGACY_REFRESH_PENDING = true`** con `storeSaveStrict` (rechaza en
   fallo) y esperar confirmación. Recién entonces se toca memoria.
2. **Marcar los eventos como consumidos** (`_localStockRolledBack` /
   `_legacyStockRestored`) y **persistir la cola** (`storeSaveStrict`). Memoria
   solo tras persistir.
3. **Aplicar la reversión local** de stock (idempotente: las marcas de consumo ya
   son durables, así que un re-run no vuelve a revertir).
4. **Retirar los eventos** y **persistir la cola final** (`storeSaveStrict`).

Las reversiones se capturan ANTES del paso 2, para que sean idempotentes.

### Comportamiento ante fallos (recuperable siempre)

| Falla en | Resultado | Estado |
|---|---|---|
| 1 (pending) | `pending_persist_failed` | nada tocado: sin marca, sin reversión, sin retiro. Retry. |
| 2 (cola marcada) | `mark_persist_failed` | pending **ya durable**; eventos intactos y **sin** reversión. Retry limpio. |
| 4 (cola final) | `reverted_removal_unpersisted` (ok) | pending durable + eventos marcados + reversión hecha. Al reiniciar se re-migra **sin doble reversión** (marcas ⇒ `planLegacyReversal='none'`). |

Ningún fallo produce `unhandled rejection` (el orquestador los captura).

## Guard del dispatcher

`processOneItem` **awaita** `discardLegacyRefillUnload` (misma operación durable).
Solo trata el evento como manejado si `res.ok`. Si la persistencia crítica falla:
no lo envía, no lo marca procesado, lo conserva para retry, y **no bloquea** al
resto de la cola (el ciclo continúa con los demás ítems).

## Refresh autoritativo (`legacyRefreshRunner`)

La bandera `legacyRefreshPending` (durable) solo se limpia tras:

- una carga de inventario **explícitamente autoritativa** para el warehouse
  esperado — `useProductStore.loadProductsAuthoritative` devuelve un resultado
  tipado; **no** se infiere éxito por Promise resuelta ni por `error === null`;
  `global_legacy` o warehouse distinto ⇒ **no autoritativo** ⇒ conserva pending; y
- una **limpieza durable confirmada** (`markLegacyRefreshCompleted` persiste
  `false` con `storeSaveStrict` y espera; si falla ⇒ `completion_persist_failed`,
  pending se conserva, retry seguro — se prefiere repetir el refresh a perderlo).

Guards del runner: sin pending / offline / sin warehouse / ya in-flight (guard
in-flight síncrono ⇒ dos wakeups simultáneos = un solo refresh).

### Disparadores

`requestLegacyAuthoritativeRefresh()` se llama en: fin del bootstrap/rehydrate
(sin esperar una transición de NetInfo), reconexión y foreground. Si el warehouse
aparece después del arranque, el siguiente wake lo intenta. No hay polling.
