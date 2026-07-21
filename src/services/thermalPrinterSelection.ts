import {
  STORAGE_KEYS,
  storeLoad,
  storeRemoveStrict,
  storeSaveStrict,
} from '../persistence/storage.ts';
import type { BondedBluetoothDevice } from './thermalPrinterTypes.ts';

export interface SavedThermalPrinterV1 {
  version: 1;
  name: string | null;
  address: string;
}

interface ThermalPrinterSelectionStorage {
  load: (key: string) => Promise<unknown>;
  save: (key: string, value: SavedThermalPrinterV1) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export interface ThermalPrinterSelectionStore {
  load: () => Promise<SavedThermalPrinterV1 | null>;
  save: (selection: BondedBluetoothDevice) => Promise<void>;
  remove: () => Promise<void>;
}

const BLUETOOTH_MAC_ADDRESS = /^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const SAVED_SELECTION_KEYS = new Set(['version', 'name', 'address']);

export function parseSavedThermalPrinter(value: unknown): SavedThermalPrinterV1 | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  const keys = Object.keys(value);
  if (keys.length !== SAVED_SELECTION_KEYS.size) return null;
  if (keys.some((key) => !SAVED_SELECTION_KEYS.has(key))) return null;
  if (!('version' in value) || value.version !== 1) return null;
  if (!('name' in value) || (value.name !== null && typeof value.name !== 'string')) return null;
  if (!('address' in value) || typeof value.address !== 'string') return null;
  if (!BLUETOOTH_MAC_ADDRESS.test(value.address)) return null;

  return {
    version: 1,
    name: value.name,
    address: value.address,
  };
}

const defaultStorage: ThermalPrinterSelectionStorage = {
  load: (key) => storeLoad<unknown>(key),
  save: (key, value) => storeSaveStrict(key, value),
  remove: (key) => storeRemoveStrict(key),
};

export function createThermalPrinterSelectionStore(
  storage: ThermalPrinterSelectionStorage = defaultStorage,
): ThermalPrinterSelectionStore {
  return {
    async load() {
      const persisted = await storage.load(STORAGE_KEYS.THERMAL_PRINTER);
      return parseSavedThermalPrinter(persisted);
    },

    async save(selection) {
      if (!BLUETOOTH_MAC_ADDRESS.test(selection.address)) {
        throw new Error('Invalid Bluetooth address');
      }
      await storage.save(STORAGE_KEYS.THERMAL_PRINTER, {
        version: 1,
        name: selection.name,
        address: selection.address,
      });
    },

    async remove() {
      await storage.remove(STORAGE_KEYS.THERMAL_PRINTER);
    },
  };
}

const thermalPrinterSelectionStore = createThermalPrinterSelectionStore();

export function loadSavedThermalPrinter(): Promise<SavedThermalPrinterV1 | null> {
  return thermalPrinterSelectionStore.load();
}

export function saveThermalPrinter(selection: BondedBluetoothDevice): Promise<void> {
  return thermalPrinterSelectionStore.save(selection);
}

export function removeSavedThermalPrinter(): Promise<void> {
  return thermalPrinterSelectionStore.remove();
}
