import { create } from 'zustand';
import {
  loadCurrentEmployeeDayBundle,
  prepareCurrentEmployeeDayBundle,
} from '../services/employeeDayBundle.ts';
import type { DayBundleAccess, StoredDayBundle } from '../services/employeeDayBundleLogic.ts';

export interface BundleNoSaleReason {
  id: number;
  code: string;
  label: string;
}

interface EmployeeDayBundleState {
  record: StoredDayBundle | null;
  access: DayBundleAccess | null;
  noSaleReasons: BundleNoSaleReason[];
  competitors: string[];
  isRefreshing: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  prepare: () => Promise<void>;
  reset: () => void;
}

function catalogue(record: StoredDayBundle | null): Pick<EmployeeDayBundleState, 'noSaleReasons' | 'competitors'> {
  if (!record) return { noSaleReasons: [], competitors: [] };
  const noSaleReasons = record.bundle.no_sale_reasons.flatMap((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const { code, name } = entry as Record<string, unknown>;
    if (typeof code !== 'string' || !code.trim() || typeof name !== 'string' || !name.trim()) return [];
    return [{ id: index + 1, code, label: name }];
  });
  const competitors = record.bundle.competitors.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const name = (entry as Record<string, unknown>).name;
    return typeof name === 'string' && name.trim() ? [name] : [];
  });
  return { noSaleReasons, competitors };
}

const empty = { record: null, access: null, noSaleReasons: [], competitors: [], isRefreshing: false, error: null };

export const useEmployeeDayBundleStore = create<EmployeeDayBundleState>((set) => ({
  ...empty,
  hydrate: async () => {
    try {
      const loaded = await loadCurrentEmployeeDayBundle();
      if (!loaded) {
        set({ ...empty });
        return;
      }
      set({ record: loaded.record, access: loaded.access, ...catalogue(loaded.record), error: null });
    } catch (error) {
      set({ ...empty, error: error instanceof Error ? error.message : 'No se pudieron validar los datos guardados.' });
    }
  },
  prepare: async () => {
    set({ isRefreshing: true, error: null });
    try {
      const prepared = await prepareCurrentEmployeeDayBundle();
      const loaded = await loadCurrentEmployeeDayBundle();
      if (!loaded || loaded.record.etag !== prepared.record.etag) {
        throw new Error('Los datos recibidos no se pudieron validar en el dispositivo.');
      }
      set({ record: loaded.record, access: loaded.access, ...catalogue(loaded.record), isRefreshing: false, error: null });
    } catch (error) {
      set({ isRefreshing: false, error: error instanceof Error ? error.message : 'No se pudieron preparar los datos del día.' });
      throw error;
    }
  },
  reset: () => set({ ...empty }),
}));
