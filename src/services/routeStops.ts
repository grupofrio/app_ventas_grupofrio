import type { GFStop } from '../types/plan';

export function removeStopById<T extends Pick<GFStop, 'id'>>(stops: T[], stopId: number): T[] {
  return stops.filter((stop) => stop.id !== stopId);
}

type SearchableRouteStop = Pick<GFStop, 'id' | 'customer_id' | 'customer_name'> &
  Partial<Pick<GFStop,
    | 'customer_ref'
    | 'contact_name'
    | 'phone'
    | 'mobile'
    | 'email'
    | 'route_sequence'
    | '_isOffroute'
  >>;

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isPlannedStop(stop: SearchableRouteStop): boolean {
  return stop._isOffroute !== true && stop.id > 0;
}

export function filterPlannedStopsBySearch<T extends SearchableRouteStop>(stops: T[], query: string): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return stops.filter(isPlannedStop);
  }

  return stops.filter((stop) => {
    if (!isPlannedStop(stop)) return false;
    const searchableText = [
      stop.customer_name,
      stop.customer_ref,
      stop.contact_name,
      stop.phone,
      stop.mobile,
      stop.email,
      String(stop.customer_id),
      stop.route_sequence == null ? '' : String(stop.route_sequence),
    ]
      .filter(Boolean)
      .join(' ');

    return normalizeSearchText(searchableText).includes(normalizedQuery);
  });
}
