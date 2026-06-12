/**
 * Offroute virtual stop drafts — persistence policy.
 *
 * Virtual stops are created client-side for offroute sales / prospections
 * that don't exist on the backend plan. They're stored inside
 * useRouteStore.stops alongside real stops so every consumer that reads
 * `stops` keeps working unchanged.
 *
 * Two problems this module handles:
 *
 * 1. Plan refresh (`loadPlan`) used to REPLACE the stops array with the
 *    backend payload, silently dropping any in-flight virtual stop —
 *    if the user reopened the app mid-sale the draft was gone.
 *    `mergeBackendStopsWithDrafts` preserves them.
 *
 * 2. If a flow crashes between `addVirtualStop` and its corresponding
 *    `removeStop`, the draft would live forever. We garbage-collect
 *    virtuals older than `VIRTUAL_STOP_TTL_MS` on every refresh so
 *    stale orphans don't accumulate across sessions.
 *
 * Virtual stops are identified by `_isOffroute === true` OR a negative
 * id (the historical marker still used by virtualStops.ts).
 */

import type { GFStop } from '../types/plan';

// 2 hours. Long enough to survive a reboot mid-sale, short enough that
// an orphaned draft doesn't clutter the route the next morning.
export const VIRTUAL_STOP_TTL_MS = 2 * 60 * 60 * 1000;

const ACTIVE_VIRTUAL_STATES = new Set(['pending', 'in_progress']);

export function isVirtualStop(stop: Pick<GFStop, 'id' | '_isOffroute'>): boolean {
  if (stop._isOffroute === true) return true;
  if (typeof stop.id === 'number' && stop.id < 0) return true;
  return false;
}

export function extractVirtualDrafts(stops: GFStop[]): GFStop[] {
  return stops.filter(isVirtualStop);
}

/**
 * Returns the list of virtual stops that should survive into the next
 * stops array after a plan refresh. Drops any virtual stop older than
 * `VIRTUAL_STOP_TTL_MS` (measured against `now`).
 */
export function pruneStaleVirtualDrafts(
  drafts: GFStop[],
  now: number = Date.now(),
  ttlMs: number = VIRTUAL_STOP_TTL_MS,
): GFStop[] {
  return drafts.filter((draft) => {
    const createdAt = draft._virtualCreatedAt;
    if (typeof createdAt !== 'number') {
      // Legacy drafts without a timestamp — keep them on this refresh
      // but stamp them so the next refresh can apply the TTL.
      return true;
    }
    return now - createdAt < ttlMs;
  });
}

/**
 * Stamps `_virtualCreatedAt` on any virtual draft that's missing it.
 * Idempotent. Used on rehydrate / after merge so legacy drafts start
 * participating in TTL cleanup.
 */
export function stampMissingCreatedAt(
  stops: GFStop[],
  now: number = Date.now(),
): GFStop[] {
  let mutated = false;
  const next = stops.map((stop) => {
    if (!isVirtualStop(stop)) return stop;
    if (typeof stop._virtualCreatedAt === 'number') return stop;
    mutated = true;
    return { ...stop, _virtualCreatedAt: now };
  });
  return mutated ? next : stops;
}

function activeVirtualDraftEntityKey(stop: GFStop): string | null {
  if (!isVirtualStop(stop)) return null;
  if (!ACTIVE_VIRTUAL_STATES.has(stop.state)) return null;

  const entityType = stop._entityType ?? 'customer';
  if (entityType === 'lead') {
    return `lead:${stop._leadId ?? stop.customer_id}`;
  }
  return `customer:${stop._partnerId ?? stop.customer_id}`;
}

export function findActiveVirtualDraftForEntity(
  stops: GFStop[],
  input: {
    entityType?: 'customer' | 'lead';
    customerId: number;
    leadId?: number | null;
    partnerId?: number | null;
  },
): GFStop | null {
  const entityType = input.entityType ?? 'customer';
  const targetLeadId = input.leadId ?? null;
  const targetPartnerId = input.partnerId ?? null;
  const targetCustomerId = input.customerId;

  return stops.find((stop) => {
    const key = activeVirtualDraftEntityKey(stop);
    if (!key) return false;

    if (entityType === 'lead') return key === `lead:${targetLeadId ?? targetCustomerId}`;
    return key === `customer:${targetPartnerId ?? targetCustomerId}`;
  }) ?? null;
}

export function dedupeActiveVirtualDrafts(stops: GFStop[]): GFStop[] {
  const seenActiveVirtualKeys = new Set<string>();
  return stops.filter((stop) => {
    const key = activeVirtualDraftEntityKey(stop);
    if (!key) return true;
    if (seenActiveVirtualKeys.has(key)) return false;
    seenActiveVirtualKeys.add(key);
    return true;
  });
}

/**
 * Merge backend stops with currently-held virtual drafts.
 * - Real stops from backend come first (preserves server order).
 * - Any backend stop that collides with a draft id wins (shouldn't
 *   happen since drafts have negative ids, but defensive).
 * - Stale drafts (older than TTL) are dropped.
 */
export function mergeBackendStopsWithDrafts(
  backendStops: GFStop[],
  existingStops: GFStop[],
  now: number = Date.now(),
): GFStop[] {
  const drafts = extractVirtualDrafts(existingStops);
  const fresh = dedupeActiveVirtualDrafts(pruneStaleVirtualDrafts(drafts, now));
  if (fresh.length === 0) return backendStops;

  const backendIds = new Set(backendStops.map((s) => s.id));
  const survivingDrafts = fresh.filter((d) => !backendIds.has(d.id));
  return [...backendStops, ...survivingDrafts];
}
