/**
 * Virtual (offroute) stop factory.
 *
 * Single source of truth for the shape of a client-side virtual stop.
 * Before this module existed, two places built virtual stops:
 *   - useRouteStore.addVirtualStop() (route list)
 *   - app/offroute.tsx handleSelect() (passed to visitStore.startVisit)
 * Those two objects could drift — e.g. the visit-store copy was missing
 * `_virtualCreatedAt`, which is the timestamp the offroute-drafts TTL
 * relies on. Centralising the factory keeps both call sites honest.
 *
 * Invariants guaranteed by `createVirtualStop`:
 *   - id is negative (distinguishes from any real backend stop id).
 *   - `_isOffroute` is true.
 *   - `_virtualCreatedAt` is a fresh millisecond timestamp, required by
 *     offrouteDrafts.ts for TTL garbage-collection.
 *   - `source_model` is 'gf.route.stop' — the only value the rest of
 *     the app understands today.
 *   - state is 'pending' so the route/guards code treats it like any
 *     other fresh stop until check-in transitions it.
 */

import type { GFStop } from '../types/plan';

export interface CreateVirtualStopInput {
  customerId: number;
  customerName: string;
  entityType?: 'customer' | 'lead';
  leadId?: number | null;
  partnerId?: number | null;
  offrouteVisitId?: number | null;
  pricelistId?: number | null;
  pricelistName?: string | null;
  customerLatitude?: number | null;
  customerLongitude?: number | null;
  googleMapsUrl?: string | null;
  /** Only overridden by tests — production always uses Date.now(). */
  now?: number;
}

export function createVirtualStop(input: CreateVirtualStopInput): GFStop {
  const now = input.now ?? Date.now();
  return {
    // Negative modulo keeps collisions with real backend ids (which
    // are positive) impossible, and keeps the int small enough for
    // safe JSON serialisation.
    id: -(now % 1_000_000),
    customer_id: input.customerId,
    customer_name: input.customerName,
    state: 'pending',
    source_model: 'gf.route.stop',
    route_sequence: 999,
    _entityType: input.entityType ?? 'customer',
    _isOffroute: true,
    _leadId: input.leadId ?? null,
    _partnerId: input.partnerId ?? null,
    _offrouteVisitId: input.offrouteVisitId ?? null,
    _pricelistId: input.pricelistId ?? null,
    _pricelistName: input.pricelistName ?? null,
    customer_latitude: input.customerLatitude ?? undefined,
    customer_longitude: input.customerLongitude ?? undefined,
    google_maps_url: input.googleMapsUrl ?? undefined,
    _virtualCreatedAt: now,
  };
}
