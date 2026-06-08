import { create } from 'zustand';

interface NavigationStore {
  active: boolean;
  targetStopId: number | null;
  startNavigation: (stopId: number) => void;
  stopNavigation: () => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  active: false,
  targetStopId: null,
  startNavigation: (stopId) => set({ active: true, targetStopId: stopId }),
  stopNavigation: () => set({ active: false, targetStopId: null }),
}));
