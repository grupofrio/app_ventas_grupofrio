/**
 * legacyRefillUnloadMigration — compatibilidad por UNA versión.
 *
 * Contexto: el flujo antiguo de la app permitía SOLICITAR recarga (pantalla
 * refill) y DESCARGAR/devolver inventario (pantalla unload). Ambas encolaban
 * operaciones offline (como `prospection` con payload `van.refill.request` /
 * `van.unload.request`, o —en versiones aún más viejas— con `type` de cola
 * `refill`/`unload`). Ese modelo se retira: la recarga la crea Almacén/CEDIS y
 * el vendedor solo la ACEPTA; la devolución (vendible + merma) se captura en el
 * Corte. Ver el PR frontend de limpieza.
 *
 * Este módulo detecta esos eventos legacy que pudieran haber quedado en la cola
 * offline persistida y los MIGRA de forma segura:
 *   - nunca se reenvían a endpoints (ni /lead/upsert ni /api/create_update);
 *   - se revierte idempotentemente cualquier delta de stock local aplicado;
 *   - unload sin delta explícito → restaura sus líneas UNA vez (marca de
 *     migración para no doble-restaurar);
 *   - refill sin delta → NO toca stock (nunca aplicó delta);
 *   - se retiran de la cola activa;
 *   - el refresh autoritativo de inventario (al reconectar) corrige cualquier
 *     desfase local restante.
 *
 * Helpers PUROS / RN-free (node-testables). La aplicación real de la reversión y
 * el retiro de la cola viven en useSyncStore, que consume estas funciones.
 */

import { computeLocalStockReversal } from './stockRollback.ts';

export type LegacyRefillUnloadKind = 'refill' | 'unload';

export interface LegacyQueueItemLike {
  id?: string;
  type?: string;
  payload?: Record<string, unknown> | null;
}

/**
 * Clasifica un ítem de cola como legacy de recarga/devolución, o null si no lo
 * es. Cubre las tres huellas históricas:
 *   - `type` de cola `refill`/`unload` (dispatcher viejo, hoy código muerto);
 *   - `payload.model` = `van.refill.request` / `van.unload.request` / `van.unload`;
 *   - `payload.type` = `refill` / `unload` (encolado como `prospection`).
 */
export function legacyRefillUnloadKind(item: LegacyQueueItemLike | null | undefined): LegacyRefillUnloadKind | null {
  if (!item) return null;
  if (item.type === 'refill') return 'refill';
  if (item.type === 'unload') return 'unload';
  const p = (item.payload ?? {}) as Record<string, unknown>;
  const model = typeof p.model === 'string' ? p.model : '';
  const ptype = typeof p.type === 'string' ? p.type : '';
  if (model === 'van.refill.request' || ptype === 'refill') return 'refill';
  if (model === 'van.unload.request' || model === 'van.unload' || ptype === 'unload') return 'unload';
  return null;
}

/** True si el ítem es un evento legacy de recarga/devolución. */
export function isLegacyRefillUnloadItem(item: LegacyQueueItemLike | null | undefined): boolean {
  return legacyRefillUnloadKind(item) !== null;
}

export interface LegacyReversalPlan {
  kind: LegacyRefillUnloadKind;
  /** Reversión a aplicar al stock local: { product_id, qty } donde qty se SUMA. */
  reversal: Array<{ product_id: number; qty: number }>;
  /**
   * Origen de la reversión:
   *  - 'delta'        : había `_localStockDelta` comprobable → se revierte;
   *  - 'unload_lines' : unload sin delta → restaurar líneas UNA vez;
   *  - 'none'         : nada que revertir (refill sin delta, o ya revertido/consumido).
   */
  source: 'delta' | 'unload_lines' | 'none';
}

/** Extrae líneas { product_id, qty>0 } válidas del payload (defensivo). */
function extractLines(payload: Record<string, unknown>): Array<{ product_id: number; qty: number }> {
  const raw = payload.lines;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ product_id: number; qty: number }> = [];
  for (const l of raw) {
    const e = l as { product_id?: unknown; qty?: unknown } | null;
    if (
      e && typeof e.product_id === 'number' && Number.isFinite(e.product_id) &&
      typeof e.qty === 'number' && Number.isFinite(e.qty) && e.qty > 0
    ) {
      out.push({ product_id: e.product_id, qty: e.qty });
    }
  }
  return out;
}

/**
 * Plan de reversión de stock local para un ítem legacy. Puro: no muta el payload
 * ni toca ningún store. Idempotente por construcción:
 *  - delta ya revertido (`_localStockRolledBack`) → computeLocalStockReversal
 *    devuelve [] → source 'none';
 *  - unload ya restaurado (`_legacyStockRestored`) → source 'none'.
 */
export function planLegacyReversal(item: LegacyQueueItemLike | null | undefined): LegacyReversalPlan | null {
  const kind = legacyRefillUnloadKind(item);
  if (!kind) return null;
  const payload = (item!.payload ?? {}) as Record<string, unknown>;

  // 1) Delta explícito manda (idempotente vía `_localStockRolledBack`).
  const deltaReversal = computeLocalStockReversal(payload);
  if (deltaReversal.length > 0) {
    return { kind, reversal: deltaReversal, source: 'delta' };
  }
  // 2) Había delta pero ya se revirtió (o era 0): nada que hacer, no restaurar por líneas.
  if (Array.isArray(payload._localStockDelta)) {
    return { kind, reversal: [], source: 'none' };
  }
  // 3) unload legacy SIN delta explícito → restaurar líneas UNA sola vez.
  if (kind === 'unload' && payload._legacyStockRestored !== true) {
    const reversal = extractLines(payload); // unload descontó stock → restaurar +qty
    if (reversal.length > 0) return { kind, reversal, source: 'unload_lines' };
  }
  // 4) refill legacy sin delta → NO tocar stock; o nada aplicable.
  return { kind, reversal: [], source: 'none' };
}

/** La bandera de payload que marca "ya consumido" según el origen de la reversión. */
export function consumedFlagForSource(source: LegacyReversalPlan['source']): '_localStockRolledBack' | '_legacyStockRestored' | null {
  if (source === 'delta') return '_localStockRolledBack';
  if (source === 'unload_lines') return '_legacyStockRestored';
  return null;
}

/** Separa la cola en ítems legacy (a migrar) y el resto (intacto). */
export function partitionLegacyRefillUnload<T extends LegacyQueueItemLike>(queue: T[]): { legacy: T[]; kept: T[] } {
  const legacy: T[] = [];
  const kept: T[] = [];
  for (const item of Array.isArray(queue) ? queue : []) {
    if (isLegacyRefillUnloadItem(item)) legacy.push(item);
    else kept.push(item);
  }
  return { legacy, kept };
}

// ── Orquestador DURABLE del retiro de eventos legacy (P1-1) ──────────────────
//
// Orden obligatorio, con la reparación pendiente durable ANTES de retirar la cola
// o tocar stock, para que NUNCA se pierda la necesidad de refresh:
//   1. persistir durablemente LEGACY_REFRESH_PENDING=true (estricto);
//   2. marcar los eventos como consumidos y persistir la cola (estricto);
//   3. aplicar la reversión local (idempotente: solo tras marcar/persistir);
//   4. retirar los eventos y persistir la cola final.
//
// Fallos:
//   - (1) falla  → nada tocado: no se marca, no se revierte, no se retira; retry.
//   - (2) falla  → pending ya durable; eventos intactos y SIN reversión; retry limpio.
//   - (4) falla  → pending durable + eventos marcados consumidos + reversión hecha;
//                  RECUPERABLE: al reiniciar se re-migra sin doble reversión (los
//                  flags de consumo hacen que planLegacyReversal devuelva 'none').
// Un único helper compartido por la migración (rehidratado) y el guard del
// dispatcher, para no duplicar la lógica durable.

export interface DurableMigrationSteps {
  /** 1. Persistir durablemente pending=true (estricto: rechaza en fallo). */
  persistPendingTrue: () => Promise<void>;
  /** 2. Marcar eventos consumidos + persistir la cola (estricto). */
  markConsumedAndPersist: () => Promise<void>;
  /** 3. Aplicar reversión local (idempotente). Solo tras (2) exitoso. */
  applyReversal: () => void;
  /** 4. Retirar eventos + persistir la cola final. */
  removeAndPersist: () => Promise<void>;
  onPhaseError: (
    phase: 'persist_pending' | 'persist_marked' | 'persist_final',
    error: unknown,
  ) => void;
}

// SOLO 'completed' es éxito (ok:true). `reverted_removal_unpersisted` es ok:FALSE:
// la operación NO está completada (el evento sigue en cola), aunque sea
// recuperable (pending + marcas de consumo durables, stock ya revertido). Tratarla
// como éxito hacía que el procesador la considerara "manejada" y programara
// drain_now → redrenaje agresivo si el storage seguía fallando.
export type DurableMigrationResult =
  | { ok: true; phase: 'completed' }
  | {
      ok: false;
      phase: 'pending_persist_failed' | 'mark_persist_failed' | 'reverted_removal_unpersisted';
    };

export async function runDurableLegacyMigration(
  steps: DurableMigrationSteps,
): Promise<DurableMigrationResult> {
  // 1. La reparación pendiente debe quedar durable ANTES de tocar cola/stock.
  try {
    await steps.persistPendingTrue();
  } catch (error) {
    steps.onPhaseError('persist_pending', error);
    return { ok: false, phase: 'pending_persist_failed' };
  }
  // 2. Marcar consumido + persistir. Si falla, no se toca stock (retry limpio).
  try {
    await steps.markConsumedAndPersist();
  } catch (error) {
    steps.onPhaseError('persist_marked', error);
    return { ok: false, phase: 'mark_persist_failed' };
  }
  // 3. Reversión local (segura: flags de consumo ya durables → sin doble revert).
  steps.applyReversal();
  // 4. Retiro final. Si falla: RECUPERABLE pero NO completado → ok:false. El
  //    procesador debe DIFERIR con backoff (no drain_now, no dead, no reenvío).
  try {
    await steps.removeAndPersist();
  } catch (error) {
    steps.onPhaseError('persist_final', error);
    return { ok: false, phase: 'reverted_removal_unpersisted' };
  }
  return { ok: true, phase: 'completed' };
}

// ── Handler ÚNICO del resultado de una migración durable (P2 Codex) ──────────
//
// Usado por processOneItem (dispatcher) Y migrateLegacyRefillUnload (rehydrate) Y
// discard: NO duplicar la decisión de defer/wake. Semántica:
//  - `completed` → 'completed' (ya retirado); despierta el runner (pending sigue
//    true hasta el refresh autoritativo).
//  - cualquier otra fase → 'deferred': difiere el lote con backoff (status='error',
//    retries=0 → nunca dead, next_retry_at futuro → fuera de elegibilidad).
//  - el refresh solo se despierta si el pending quedó DURABLE, es decir en toda
//    fase EXCEPTO `pending_persist_failed` (donde el paso 1 falló).
export interface MigrationResultEffects {
  /** Difiere el lote con backoff (status='error', retries=0). */
  defer: () => void;
  /** Despierta el runner del refresh autoritativo (tras pending durable). */
  notifyRefreshPending: () => void;
}

export function handleDurableMigrationResult(
  result: DurableMigrationResult,
  effects: MigrationResultEffects,
): 'completed' | 'deferred' {
  // Wake DESPUÉS de crear pending durable (todas las fases salvo la que no lo creó).
  if (result.phase !== 'pending_persist_failed') {
    effects.notifyRefreshPending();
  }
  if (result.ok) return 'completed';
  // No completado → diferir con backoff (nunca elegible de inmediato → sin drain_now).
  effects.defer();
  return 'deferred';
}

/** Copy del aviso NO bloqueante al usuario tras migrar/descartar solicitudes legacy. */
export function legacyMigrationNoticeCopy(count: number): { title: string; body: string } {
  const n = count > 0 ? count : 0;
  return {
    title: 'Solicitudes antiguas descartadas',
    body:
      `Se descartaron ${n} solicitud(es) de recarga o devolución del modo anterior. ` +
      'Ahora la recarga la gestiona Almacén (tú solo la aceptas) y la devolución se captura en el Corte.',
  };
}
