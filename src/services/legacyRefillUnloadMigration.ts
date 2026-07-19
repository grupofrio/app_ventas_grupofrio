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
