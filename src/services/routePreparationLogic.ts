/**
 * Pure helpers for route preparation.
 *
 * Kept side-effect-free so they can be unit-tested without React Native /
 * zustand. The store (`useRoutePreparationStore`) wires them up to the real
 * route, product and pricelist services.
 */

export interface PreparationFailure {
  partnerId: number;
  customerName?: string;
  reason: string;
}

export interface PartnerLike {
  customer_id?: number | null;
  customer_name?: string | null;
}

/**
 * Deduplicate partner ids from a list of stops, dropping invalid ids
 * (null, undefined, non-positive). Order is preserved by first occurrence
 * so the preload pulls clients in roughly route order.
 */
export function dedupePartnerIds(stops: PartnerLike[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const stop of stops) {
    const id = stop?.customer_id;
    if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Build a quick lookup from partner id → customer name so failure entries
 * can carry a human-readable label.
 */
export function buildCustomerNameMap(stops: PartnerLike[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const stop of stops) {
    if (typeof stop?.customer_id === 'number' && stop.customer_id > 0 && stop.customer_name) {
      if (!map.has(stop.customer_id)) {
        map.set(stop.customer_id, stop.customer_name);
      }
    }
  }
  return map;
}

/**
 * Decide whether the route is "freshly prepared" relative to the current
 * plan id. Returns true when the last preparation was for the same plan.
 * Used by the UI to switch the card to its "ready" state without leaking
 * stale preparations across plans (eg. when a Jefe de Ruta pushes a new
 * plan mid-day).
 */
export function isPreparationFreshForPlan(
  preparedPlanId: number | null,
  currentPlanId: number | null | undefined,
): boolean {
  if (preparedPlanId === null) return false;
  if (currentPlanId === null || currentPlanId === undefined) return false;
  return preparedPlanId === currentPlanId;
}

/**
 * Format a unix-ms timestamp as "HH:mm" 24h. Returns "" for null.
 * Pure / locale-independent so tests don't depend on the runtime tz.
 */
export function formatPreparedAt(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
