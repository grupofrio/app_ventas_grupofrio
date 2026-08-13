/**
 * Location store — GPS state with geo-fence calculation.
 * From KOLD_FIELD_SPEC.md sections 7-8.
 *
 * States:
 *   loading — requesting permission / getting location
 *   denied — permission denied
 *   unavailable — GPS hardware not available
 *   ready — location available, distance calculated
 *   error — unexpected error
 */

import { create } from 'zustand';

export type LocationStatus = 'loading' | 'denied' | 'unavailable' | 'ready' | 'error';

// F3.6: fuente única del radio de geocerca — antes checkin/[stopId].tsx y
// trustSignals.ts declaraban su propia copia local del mismo valor (50m),
// sin ninguna importada de aquí, así que un cambio futuro no se propagaba.
export const GEO_FENCE_RADIUS_M = 50;

interface LocationState {
  status: LocationStatus;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  lastUpdated: number | null;
  errorMessage: string | null;

  // Geo-fence for current stop
  targetLat: number | null;
  targetLon: number | null;
  distanceMeters: number | null;
  isWithinFence: boolean;

  // Actions
  setLocation: (lat: number, lon: number, accuracy: number) => void;
  setTarget: (lat: number | null | undefined, lon: number | null | undefined) => void;
  setStatus: (status: LocationStatus, error?: string) => void;
  clearTarget: () => void;
}

/**
 * Haversine distance between two GPS coordinates.
 * Returns distance in meters.
 */
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const useLocationStore = create<LocationState>((set, get) => ({
  status: 'loading',
  latitude: null,
  longitude: null,
  accuracy: null,
  lastUpdated: null,
  errorMessage: null,
  targetLat: null,
  targetLon: null,
  distanceMeters: null,
  isWithinFence: false,

  setLocation: (lat, lon, accuracy) => {
    const { targetLat, targetLon } = get();
    let distance: number | null = null;
    let isWithin = false;

    if (targetLat != null && targetLon != null) {
      distance = Math.round(haversineDistance(lat, lon, targetLat, targetLon));
      isWithin = distance <= GEO_FENCE_RADIUS_M;
    }

    set({
      status: 'ready',
      latitude: lat,
      longitude: lon,
      accuracy,
      lastUpdated: Date.now(),
      distanceMeters: distance,
      isWithinFence: isWithin,
      errorMessage: null,
    });
  },

  setTarget: (lat, lon) => {
    const { latitude, longitude } = get();
    let distance: number | null = null;
    let isWithin = false;

    if (lat != null && lon != null && latitude != null && longitude != null) {
      distance = Math.round(haversineDistance(latitude, longitude, lat, lon));
      isWithin = distance <= GEO_FENCE_RADIUS_M;
    }

    set({
      targetLat: lat ?? null,
      targetLon: lon ?? null,
      distanceMeters: distance,
      isWithinFence: isWithin,
    });
  },

  setStatus: (status, error) => set({
    status,
    errorMessage: error || null,
  }),

  clearTarget: () => set({
    targetLat: null,
    targetLon: null,
    distanceMeters: null,
    isWithinFence: false,
  }),
}));
