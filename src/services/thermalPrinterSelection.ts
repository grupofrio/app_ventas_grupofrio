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

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const keys = Reflect.ownKeys(value);
    if (keys.length !== SAVED_SELECTION_KEYS.size) return null;
    if (keys.some((key) => typeof key !== 'string' || !SAVED_SELECTION_KEYS.has(key))) return null;

    const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'version');
    const nameDescriptor = Object.getOwnPropertyDescriptor(value, 'name');
    const addressDescriptor = Object.getOwnPropertyDescriptor(value, 'address');
    if (!versionDescriptor || !('value' in versionDescriptor)) return null;
    if (!nameDescriptor || !('value' in nameDescriptor)) return null;
    if (!addressDescriptor || !('value' in addressDescriptor)) return null;

    const version: unknown = versionDescriptor.value;
    const name: unknown = nameDescriptor.value;
    const address: unknown = addressDescriptor.value;
    if (version !== 1) return null;
    if (name !== null && typeof name !== 'string') return null;
    if (typeof address !== 'string' || !BLUETOOTH_MAC_ADDRESS.test(address)) return null;

    return { version: 1, name, address };
  } catch {
    return null;
  }
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
      const candidate: unknown = {
        version: 1,
        name: selection.name,
        address: selection.address,
      };
      const savedSelection = parseSavedThermalPrinter(candidate);
      if (savedSelection === null) {
        throw new Error(
          'Invalid thermal printer selection: expected a string or null name and a valid Bluetooth address',
        );
      }
      await storage.save(STORAGE_KEYS.THERMAL_PRINTER, savedSelection);
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
