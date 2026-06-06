/**
 * Pure helpers for the map-first route experience. No RN, no network —
 * fully unit-testable. The map screen and bottom panel consume these.
 *
 * Stop state model (from types/plan.ts):
 *   pending | in_progress | done | not_visited | no_stock | rejected | closed
 * Sale and no-sale flows both set the stop to 'done' (visited). The "next"
 * client is the first in_progress, else the first pending, by route_sequence.
 */

import type { GFStop, StopState } from '../types/plan';

const VISITED_STATES = new Set<StopState>(['done', 'not_visited', 'closed']);

export interface StopStatusMeta {
  label: string;
  /** marker/pin + dot color */
  color: string;
}

const STATUS_META: Record<StopState, StopStatusMeta> = {
  pending: { label: 'Pendiente', color: '#8B95A3' },
  in_progress: { label: 'En curso', color: '#2563EB' },
  done: { label: 'Visitado', color: '#22C55E' },
  not_visited: { label: 'Sin visita', color: '#EF4444' },
  no_stock: { label: 'Sin stock', color: '#F59E0B' },
  rejected: { label: 'Rechazado', color: '#EF4444' },
  closed: { label: 'Cerrado', color: '#6B7280' },
};

export function stopStatusMeta(state: StopState | string): StopStatusMeta {
  return STATUS_META[state as StopState] ?? { label: String(state || '—'), color: '#8B95A3' };
}

function hasCoords(s: GFStop): boolean {
  return typeof s.customer_latitude === 'number'
    && typeof s.customer_longitude === 'number'
    && !Number.isNaN(s.customer_latitude)
    && !Number.isNaN(s.customer_longitude)
    && !(s.customer_latitude === 0 && s.customer_longitude === 0);
}

const bySeq = (a: GFStop, b: GFStop) => (a.route_sequence || 0) - (b.route_sequence || 0);

/**
 * The next client to visit: first in_progress, else first pending, by
 * route_sequence (the backend-optimized order). Returns null when none.
 */
export function selectNextStop(stops: GFStop[]): GFStop | null {
  const inProgress = stops.filter((s) => s.state === 'in_progress').sort(bySeq);
  if (inProgress.length > 0) return inProgress[0];
  const pending = stops.filter((s) => s.state === 'pending').sort(bySeq);
  return pending[0] ?? null;
}

/** Split stops into those with coordinates (map-able) and those without. */
export function splitStopsByLocation(stops: GFStop[]): {
  located: GFStop[];
  unlocated: GFStop[];
} {
  const located: GFStop[] = [];
  const unlocated: GFStop[] = [];
  for (const s of stops) {
    (hasCoords(s) ? located : unlocated).push(s);
  }
  return { located, unlocated };
}

export interface RouteProgress {
  total: number;
  visited: number;
  pending: number;
  pct: number;
  /** true when there are stops and none remain pending/in_progress. */
  completed: boolean;
}

export function computeRouteProgress(stops: GFStop[]): RouteProgress {
  const total = stops.length;
  const visited = stops.filter((s) => VISITED_STATES.has(s.state)).length;
  const pending = stops.filter((s) => s.state === 'pending' || s.state === 'in_progress').length;
  const pct = total > 0 ? Math.round((visited / total) * 100) : 0;
  return { total, visited, pending, pct, completed: total > 0 && pending === 0 };
}

/** Ordered stops by route_sequence (stable, for list rendering). */
export function orderedStops(stops: GFStop[]): GFStop[] {
  return [...stops].sort(bySeq);
}

/** Haversine distance in meters between two lat/lon points. */
export function haversineMeters(
  aLat: number, aLon: number, bLat: number, bLon: number,
): number {
  const R = 6371000; // earth radius m
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Distance from a user position to a stop, in meters. Returns null when
 * either point is missing coordinates.
 */
export function distanceToStop(
  userLat: number | null | undefined,
  userLon: number | null | undefined,
  stop: GFStop,
): number | null {
  if (typeof userLat !== 'number' || typeof userLon !== 'number') return null;
  if (!hasCoords(stop)) return null;
  return haversineMeters(userLat, userLon, stop.customer_latitude!, stop.customer_longitude!);
}

/** Human-readable distance: <1000 m → "850 m", else "2.4 km". */
export function formatDistance(meters: number | null | undefined): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
