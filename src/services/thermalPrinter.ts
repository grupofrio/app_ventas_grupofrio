import type {
  BluetoothState,
  BondedBluetoothDevice,
  ThermalPrinterNativeModule,
} from '../../modules/thermal-printer/index.ts';
import type { SavedThermalPrinterV1 } from './thermalPrinterSelection.ts';

export type ThermalPrinterPlatform = 'android' | 'ios' | 'web';
export type BluetoothConnectPermissionResult = 'granted' | 'denied' | 'never_ask_again';

export interface ThermalPrinterServiceDependencies {
  platform: ThermalPrinterPlatform;
  androidApiLevel: number;
  native: ThermalPrinterNativeModule | null;
  requestConnectPermission: () => Promise<BluetoothConnectPermissionResult>;
}

export type BondedBluetoothDeviceSnapshot = Readonly<BondedBluetoothDevice>;
export type SavedThermalPrinterSnapshot = Readonly<SavedThermalPrinterV1>;

type AccessResultBase = {
  savedPrinter: SavedThermalPrinterSnapshot | null;
};

export type ThermalPrinterAccessResult =
  | Readonly<
      AccessResultBase & {
        status: 'unsupported_platform';
        platform: Exclude<ThermalPrinterPlatform, 'android'>;
      }
    >
  | Readonly<AccessResultBase & { status: 'native_unavailable' }>
  | Readonly<AccessResultBase & { status: 'permission_denied' }>
  | Readonly<AccessResultBase & { status: 'permission_permanently_denied' }>
  | Readonly<AccessResultBase & { status: 'permission_request_failed' }>
  | Readonly<AccessResultBase & { status: 'bluetooth_unsupported' }>
  | Readonly<AccessResultBase & { status: 'bluetooth_off' }>
  | Readonly<
      AccessResultBase & {
        status: 'native_error';
        code: string | null;
      }
    >
  | Readonly<
      AccessResultBase & {
        status: 'ready';
        devices: readonly BondedBluetoothDeviceSnapshot[];
        savedPrinterBonded: boolean | null;
      }
    >;

export interface ThermalPrinterService {
  prepare(savedPrinter?: SavedThermalPrinterV1 | null): Promise<ThermalPrinterAccessResult>;
}

const ANDROID_BLUETOOTH_CONNECT_API_LEVEL = 31;
const BLUETOOTH_MAC_ADDRESS = /^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const STABLE_NATIVE_CODE = /^[a-z][a-z0-9_]{0,63}$/;

function dataProperty(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function snapshotSavedPrinter(
  savedPrinter: SavedThermalPrinterV1 | null | undefined,
): SavedThermalPrinterSnapshot | null {
  if (savedPrinter === null || savedPrinter === undefined || typeof savedPrinter !== 'object') {
    return null;
  }

  try {
    const version = dataProperty(savedPrinter, 'version');
    const name = dataProperty(savedPrinter, 'name');
    const address = dataProperty(savedPrinter, 'address');
    if (
      version !== 1 ||
      (name !== null && typeof name !== 'string') ||
      typeof address !== 'string' ||
      !BLUETOOTH_MAC_ADDRESS.test(address)
    ) {
      return null;
    }
    return Object.freeze({ version: 1, name, address });
  } catch {
    return null;
  }
}

function snapshotBondedDevice(value: unknown): BondedBluetoothDeviceSnapshot | null {
  if (value === null || typeof value !== 'object') return null;

  try {
    const name = dataProperty(value, 'name');
    const address = dataProperty(value, 'address');
    if (
      (name !== null && typeof name !== 'string') ||
      typeof address !== 'string' ||
      !BLUETOOTH_MAC_ADDRESS.test(address)
    ) {
      return null;
    }
    return Object.freeze({ name, address: address.toUpperCase() });
  } catch {
    return null;
  }
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isExactMp210(name: string | null): boolean {
  return name?.trim().toLowerCase() === 'mp210';
}

function compareBondedDevices(
  left: BondedBluetoothDeviceSnapshot,
  right: BondedBluetoothDeviceSnapshot,
): number {
  const mp210Order = Number(!isExactMp210(left.name)) - Number(!isExactMp210(right.name));
  if (mp210Order !== 0) return mp210Order;

  const nullNameOrder = Number(left.name === null) - Number(right.name === null);
  if (nullNameOrder !== 0) return nullNameOrder;

  const nameOrder = compareStrings(left.name?.toLowerCase() ?? '', right.name?.toLowerCase() ?? '');
  if (nameOrder !== 0) return nameOrder;
  return compareStrings(left.address, right.address);
}

function snapshotBondedDevices(value: unknown): readonly BondedBluetoothDeviceSnapshot[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const devices: BondedBluetoothDeviceSnapshot[] = [];
    for (const candidate of value) {
      const device = snapshotBondedDevice(candidate);
      if (device !== null) devices.push(device);
    }
    devices.sort(compareBondedDevices);
    return Object.freeze(devices);
  } catch {
    return null;
  }
}

function nativeErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  try {
    const code = dataProperty(error, 'code');
    return typeof code === 'string' && STABLE_NATIVE_CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

function frozenResult<Result extends ThermalPrinterAccessResult>(result: Result): Result {
  return Object.freeze(result);
}

export function createThermalPrinterService(
  dependencies: ThermalPrinterServiceDependencies,
): ThermalPrinterService {
  const { platform, androidApiLevel, native, requestConnectPermission } = dependencies;
  let permissionRequestInFlight: Promise<BluetoothConnectPermissionResult> | null = null;

  const requestPermissionOnce = (): Promise<BluetoothConnectPermissionResult> => {
    if (permissionRequestInFlight !== null) return permissionRequestInFlight;

    const request = Promise.resolve(requestConnectPermission());
    const sharedRequest = request.finally(() => {
      if (permissionRequestInFlight === sharedRequest) permissionRequestInFlight = null;
    });
    permissionRequestInFlight = sharedRequest;
    return sharedRequest;
  };

  return Object.freeze({
    async prepare(savedSelection: SavedThermalPrinterV1 | null = null) {
      const savedPrinter = snapshotSavedPrinter(savedSelection);
      if (platform !== 'android') {
        return frozenResult({
          status: 'unsupported_platform',
          platform,
          savedPrinter,
        });
      }
      if (native === null) {
        return frozenResult({ status: 'native_unavailable', savedPrinter });
      }

      if (androidApiLevel >= ANDROID_BLUETOOTH_CONNECT_API_LEVEL) {
        let permission: BluetoothConnectPermissionResult;
        try {
          permission = await requestPermissionOnce();
        } catch {
          return frozenResult({ status: 'permission_request_failed', savedPrinter });
        }
        if (permission === 'denied') {
          return frozenResult({ status: 'permission_denied', savedPrinter });
        }
        if (permission === 'never_ask_again') {
          return frozenResult({ status: 'permission_permanently_denied', savedPrinter });
        }
        if (permission !== 'granted') {
          return frozenResult({ status: 'permission_request_failed', savedPrinter });
        }
      }

      let state: BluetoothState;
      try {
        state = await native.getBluetoothState();
      } catch (error) {
        return frozenResult({ status: 'native_error', code: nativeErrorCode(error), savedPrinter });
      }
      if (state === 'unsupported') {
        return frozenResult({ status: 'bluetooth_unsupported', savedPrinter });
      }
      if (state === 'off') {
        return frozenResult({ status: 'bluetooth_off', savedPrinter });
      }
      if (state !== 'on') {
        return frozenResult({ status: 'native_error', code: null, savedPrinter });
      }

      let nativeDevices: unknown;
      try {
        nativeDevices = await native.getBondedDevices();
      } catch (error) {
        return frozenResult({ status: 'native_error', code: nativeErrorCode(error), savedPrinter });
      }
      const devices = snapshotBondedDevices(nativeDevices);
      if (devices === null) {
        return frozenResult({ status: 'native_error', code: null, savedPrinter });
      }

      const savedPrinterBonded = savedPrinter === null
        ? null
        : devices.some(
            (device) => device.address.toLowerCase() === savedPrinter.address.toLowerCase(),
          );
      return frozenResult({
        status: 'ready',
        devices,
        savedPrinter,
        savedPrinterBonded,
      });
    },
  });
}
