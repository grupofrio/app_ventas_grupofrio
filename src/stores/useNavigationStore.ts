import { create } from 'zustand';
import { fetchDrivingRoute } from '../services/directions';
import type { LatLng } from '../services/directions';

export type { LatLng };

interface NavigationStore {
  active: boolean;
  targetStopId: number | null;
  routeCoordinates: LatLng[];
  startNavigation: (stopId: number, origin?: LatLng | null, destination?: LatLng | null) => void;
  stopNavigation: () => void;
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  active: false,
  targetStopId: null,
  routeCoordinates: [],

  startNavigation: (stopId, origin, destination) => {
    set({ active: true, targetStopId: stopId, routeCoordinates: [] });
    if (origin && destination) {
      fetchDrivingRoute(origin, destination)
        .then((coords) => {
          // Only apply if navigation is still active for the same stop.
          if (get().active && get().targetStopId === stopId && coords) {
            set({ routeCoordinates: coords });
          }
        })
        .catch(() => {});
    }
  },

  stopNavigation: () => set({ active: false, targetStopId: null, routeCoordinates: [] }),
}));
