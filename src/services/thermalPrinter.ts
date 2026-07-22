import type {
  BluetoothState,
  BondedBluetoothDevice,
  NativePrintResult,
  ThermalTicketBranding,
  ThermalTicketDocument,
  ThermalPrinterNativeModule,
} from '../../modules/thermal-printer/index.ts';
import { SALE_TICKET_BRANDING } from './saleTicketBranding.ts';
import { requiresManualReprintConfirmation } from './thermalPrinterTypes.ts';
import type {
  SavedThermalPrinterV1,
  ThermalPrinterSelectionStore,
} from './thermalPrinterSelection.ts';

export type ThermalPrinterPlatform = 'android' | 'ios' | 'web';
export type BluetoothConnectPermissionResult = 'granted' | 'denied' | 'never_ask_again';

export interface ThermalPrinterServiceDependencies {
  platform: ThermalPrinterPlatform;
  androidApiLevel: number;
  native: ThermalPrinterNativeModule | null;
  requestConnectPermission: () => Promise<BluetoothConnectPermissionResult>;
}

export interface ThermalPrinterJobDependencies {
  selectionStore: ThermalPrinterSelectionStore;
}

export type BondedBluetoothDeviceSnapshot = Readonly<BondedBluetoothDevice>;
export type SavedThermalPrinterSnapshot = Readonly<SavedThermalPrinterV1>;
export type NativePrintProgressSnapshot = Readonly<NativePrintResult>;

export type ThermalPrintJobKind = 'ticket' | 'diagnostic';

export type ThermalPrintJobResult = Readonly<{
  status: 'sent';
  kind: ThermalPrintJobKind;
  printer: SavedThermalPrinterSnapshot;
  progress: NativePrintProgressSnapshot;
}>;

export const GENERIC_THERMAL_PRINTER_MESSAGE =
  'No se pudo enviar el ticket a la impresora.';

const THERMAL_PRINTER_MESSAGES = Object.freeze({
  bluetooth_unsupported: 'Este dispositivo no admite Bluetooth.',
  bluetooth_disabled: 'Enciende Bluetooth para continuar.',
  permission_denied: 'Se necesita permiso para conectar con la impresora.',
  printer_not_bonded:
    'La impresora seleccionada ya no está vinculada. Vuelve a vincularla o elige otra.',
  connect_timeout:
    'La impresora tardó demasiado en responder. Verifica que esté encendida y cerca.',
  connect_failed:
    'No se pudo conectar con la impresora. Verifica que esté encendida y cerca.',
  busy: 'Ya hay un ticket en proceso de envío.',
  invalid_ticket: 'El ticket contiene datos que no se pueden imprimir.',
  ticket_too_large: 'El ticket es demasiado largo para imprimirlo.',
  write_timeout: 'La impresora dejó de responder durante el envío.',
  write_failed: 'No se pudo completar el envío del ticket.',
} as const);

export type KnownThermalPrinterErrorCode = keyof typeof THERMAL_PRINTER_MESSAGES;

export function toThermalPrinterMessage(code: string): string {
  if (Object.prototype.hasOwnProperty.call(THERMAL_PRINTER_MESSAGES, code)) {
    return THERMAL_PRINTER_MESSAGES[code as KnownThermalPrinterErrorCode];
  }
  return GENERIC_THERMAL_PRINTER_MESSAGE;
}

const ZERO_PRINT_PROGRESS: NativePrintProgressSnapshot = Object.freeze({
  transportBytesWritten: 0,
  rasterBytesWritten: 0,
  bandsCompleted: 0,
  rasterPayloadAttempted: false,
});

export class ThermalPrinterError extends Error {
  readonly code: string;
  readonly phase: string | null;
  readonly progress: NativePrintProgressSnapshot;
  readonly requiresManualReprint: boolean;

  constructor(
    code: string,
    phase: string | null = null,
    progress: NativePrintProgressSnapshot = ZERO_PRINT_PROGRESS,
  ) {
    const safeCode = snapshotErrorCode(code);
    const safePhase = snapshotPhase(phase);
    const safeProgress = snapshotProgress(progress) ?? ZERO_PRINT_PROGRESS;
    super(toThermalPrinterMessage(safeCode));
    this.name = 'ThermalPrinterError';
    this.code = safeCode;
    this.phase = safePhase;
    this.progress = safeProgress;
    this.requiresManualReprint = requiresManualReprintConfirmation(safeProgress);
    try {
      Object.freeze(this);
    } catch {
      // Some Error implementations may expose non-freezable native state. All public fields
      // above still point only at validated, immutable snapshots.
    }
  }
}

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
  selectPrinter(device: BondedBluetoothDevice): Promise<SavedThermalPrinterSnapshot>;
  changePrinter(device: BondedBluetoothDevice): Promise<SavedThermalPrinterSnapshot>;
  printTicket(document: ThermalTicketDocument): Promise<ThermalPrintJobResult>;
  printDiagnostic(): Promise<ThermalPrintJobResult>;
}

const ANDROID_BLUETOOTH_CONNECT_API_LEVEL = 31;
const BLUETOOTH_MAC_ADDRESS = /^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const STABLE_NATIVE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const STABLE_NATIVE_PHASE = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_NATIVE_ERROR_ENVELOPE_LENGTH = 65_536;
const MAX_TICKET_SNAPSHOT_LINES = 10_000;

let thermalPrintJobInFlight = false;

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

function snapshotSelectionDevice(value: unknown): SavedThermalPrinterSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    return snapshotSavedPrinter({
      version: 1,
      name: dataProperty(value, 'name'),
      address: dataProperty(value, 'address'),
    } as SavedThermalPrinterV1);
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

function isMp210Name(name: string | null): boolean {
  return name?.trim().toLowerCase().includes('mp210') === true;
}

function compareBondedDevices(
  left: BondedBluetoothDeviceSnapshot,
  right: BondedBluetoothDeviceSnapshot,
): number {
  const mp210Order = Number(!isMp210Name(left.name)) - Number(!isMp210Name(right.name));
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
    const seenAddresses = new Set<string>();
    for (const candidate of value) {
      const device = snapshotBondedDevice(candidate);
      if (device !== null && !seenAddresses.has(device.address)) {
        // Native order is authoritative: the first valid snapshot for a canonical MAC wins.
        seenAddresses.add(device.address);
        devices.push(device);
      }
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

function snapshotProgress(value: unknown): NativePrintProgressSnapshot | null {
  if (value === null || typeof value !== 'object') return null;

  try {
    const transportBytesWritten = dataProperty(value, 'transportBytesWritten');
    const rasterBytesWritten = dataProperty(value, 'rasterBytesWritten');
    const bandsCompleted = dataProperty(value, 'bandsCompleted');
    const rasterPayloadAttempted = dataProperty(value, 'rasterPayloadAttempted');
    if (
      typeof transportBytesWritten !== 'number' ||
      !Number.isSafeInteger(transportBytesWritten) ||
      transportBytesWritten < 0 ||
      typeof rasterBytesWritten !== 'number' ||
      !Number.isSafeInteger(rasterBytesWritten) ||
      rasterBytesWritten < 0 ||
      typeof bandsCompleted !== 'number' ||
      !Number.isSafeInteger(bandsCompleted) ||
      bandsCompleted < 0 ||
      typeof rasterPayloadAttempted !== 'boolean'
    ) {
      return null;
    }

    return Object.freeze({
      transportBytesWritten,
      rasterBytesWritten,
      bandsCompleted,
      rasterPayloadAttempted,
    });
  } catch {
    return null;
  }
}

function snapshotPhase(value: unknown): string | null {
  return typeof value === 'string' && STABLE_NATIVE_PHASE.test(value) ? value : null;
}

function snapshotErrorCode(value: unknown): string {
  return typeof value === 'string' && STABLE_NATIVE_CODE.test(value)
    ? value
    : 'unexpected_error';
}

function nativeErrorEnvelope(error: unknown): {
  valid: boolean;
  phase: string | null;
  progress: NativePrintProgressSnapshot;
} {
  if (error === null || typeof error !== 'object') {
    return { valid: false, phase: null, progress: ZERO_PRINT_PROGRESS };
  }

  try {
    const message = dataProperty(error, 'message');
    if (
      typeof message !== 'string' ||
      message.length === 0 ||
      message.length > MAX_NATIVE_ERROR_ENVELOPE_LENGTH
    ) {
      return { valid: false, phase: null, progress: ZERO_PRINT_PROGRESS };
    }
    const parsed: unknown = JSON.parse(message);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, phase: null, progress: ZERO_PRINT_PROGRESS };
    }

    const privateMessage = dataProperty(parsed, 'message');
    const rawPhase = dataProperty(parsed, 'phase');
    const phase = snapshotPhase(rawPhase);
    const progress = snapshotProgress(dataProperty(parsed, 'progress'));
    const validPhase = rawPhase === null || phase !== null;

    return {
      valid: typeof privateMessage === 'string' && validPhase && progress !== null,
      phase,
      progress: progress ?? ZERO_PRINT_PROGRESS,
    };
  } catch {
    return { valid: false, phase: null, progress: ZERO_PRINT_PROGRESS };
  }
}

function normalizeThermalPrinterError(error: unknown): ThermalPrinterError {
  let isThermalPrinterError = false;
  try {
    isThermalPrinterError = error instanceof ThermalPrinterError;
  } catch {
    return unexpectedThermalPrinterError();
  }
  if (isThermalPrinterError && error !== null && typeof error === 'object') {
    try {
      return new ThermalPrinterError(
        snapshotErrorCode(dataProperty(error, 'code')),
        snapshotPhase(dataProperty(error, 'phase')),
        snapshotProgress(dataProperty(error, 'progress')) ?? ZERO_PRINT_PROGRESS,
      );
    } catch {
      return unexpectedThermalPrinterError();
    }
  }
  const envelope = nativeErrorEnvelope(error);
  const code = envelope.valid ? nativeErrorCode(error) ?? 'unexpected_error' : 'unexpected_error';
  return new ThermalPrinterError(code, envelope.phase, envelope.progress);
}

function unexpectedThermalPrinterError(): ThermalPrinterError {
  return new ThermalPrinterError('unexpected_error');
}

function thermalTicketBranding(): ThermalTicketBranding {
  return Object.freeze({
    logoPngBase64: SALE_TICKET_BRANDING.logoPngBase64,
    logoVersion: SALE_TICKET_BRANDING.version,
    legalName: SALE_TICKET_BRANDING.legalName,
    rfcLabel: SALE_TICKET_BRANDING.rfcLabel,
    title: SALE_TICKET_BRANDING.title,
    footer: SALE_TICKET_BRANDING.footer,
  });
}

function ownDataValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !('value' in descriptor)) {
    throw new ThermalPrinterError('invalid_ticket');
  }
  return descriptor.value;
}

function requiredTicketString(object: object, key: string): string {
  const value = ownDataValue(object, key);
  if (typeof value !== 'string') throw new ThermalPrinterError('invalid_ticket');
  return value;
}

function snapshotTicketBranding(value: unknown): ThermalTicketBranding {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ThermalPrinterError('invalid_ticket');
  }
  return Object.freeze({
    logoPngBase64: requiredTicketString(value, 'logoPngBase64'),
    logoVersion: requiredTicketString(value, 'logoVersion'),
    legalName: requiredTicketString(value, 'legalName'),
    rfcLabel: requiredTicketString(value, 'rfcLabel'),
    title: requiredTicketString(value, 'title'),
    footer: requiredTicketString(value, 'footer'),
  });
}

function snapshotTicketLine(value: unknown): ThermalTicketDocument['lines'][number] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ThermalPrinterError('invalid_ticket');
  }
  const productId = ownDataValue(value, 'productId');
  if (typeof productId !== 'number' || !Number.isFinite(productId)) {
    throw new ThermalPrinterError('invalid_ticket');
  }
  return Object.freeze({
    productId,
    productName: requiredTicketString(value, 'productName'),
    quantityAndUnitPrice: requiredTicketString(value, 'quantityAndUnitPrice'),
    lineTotal: requiredTicketString(value, 'lineTotal'),
  });
}

function snapshotTicketLines(value: unknown): ThermalTicketDocument['lines'] {
  if (!Array.isArray(value)) throw new ThermalPrinterError('invalid_ticket');
  const length = ownDataValue(value, 'length');
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_TICKET_SNAPSHOT_LINES
  ) {
    throw new ThermalPrinterError('invalid_ticket');
  }

  const lines: ThermalTicketDocument['lines'] = [];
  for (let index = 0; index < length; index += 1) {
    lines.push(snapshotTicketLine(ownDataValue(value, String(index))));
  }
  Object.freeze(lines);
  return lines;
}

function snapshotThermalTicketDocument(value: unknown): ThermalTicketDocument {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ThermalPrinterError('invalid_ticket');
    }
    if (ownDataValue(value, 'schemaVersion') !== 1) {
      throw new ThermalPrinterError('invalid_ticket');
    }

    const creditNote = Object.getOwnPropertyDescriptor(value, 'creditNote');
    if (creditNote && !('value' in creditNote)) {
      throw new ThermalPrinterError('invalid_ticket');
    }
    const creditNoteValue = creditNote && 'value' in creditNote ? creditNote.value : undefined;
    if (creditNoteValue !== undefined && typeof creditNoteValue !== 'string') {
      throw new ThermalPrinterError('invalid_ticket');
    }

    return Object.freeze({
      schemaVersion: 1,
      branding: snapshotTicketBranding(ownDataValue(value, 'branding')),
      folio: requiredTicketString(value, 'folio'),
      formattedDate: requiredTicketString(value, 'formattedDate'),
      customerName: requiredTicketString(value, 'customerName'),
      sellerName: requiredTicketString(value, 'sellerName'),
      paymentLabel: requiredTicketString(value, 'paymentLabel'),
      lines: snapshotTicketLines(ownDataValue(value, 'lines')),
      subtotal: requiredTicketString(value, 'subtotal'),
      totalKg: requiredTicketString(value, 'totalKg'),
      total: requiredTicketString(value, 'total'),
      ...(creditNoteValue === undefined ? {} : { creditNote: creditNoteValue }),
    });
  } catch {
    throw new ThermalPrinterError('invalid_ticket');
  }
}

function frozenResult<Result extends ThermalPrinterAccessResult>(result: Result): Result {
  return Object.freeze(result);
}

function nativeAccessFailure(
  code: string | null,
  savedPrinter: SavedThermalPrinterSnapshot | null,
): ThermalPrinterAccessResult {
  switch (code) {
    case 'permission_denied':
      return frozenResult({ status: 'permission_denied', savedPrinter });
    case 'bluetooth_disabled':
      return frozenResult({ status: 'bluetooth_off', savedPrinter });
    case 'bluetooth_unsupported':
      return frozenResult({ status: 'bluetooth_unsupported', savedPrinter });
    default:
      return frozenResult({ status: 'native_error', code, savedPrinter });
  }
}

export function createThermalPrinterService(
  dependencies: ThermalPrinterServiceDependencies,
  jobDependencies?: ThermalPrinterJobDependencies,
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

  const persistPrinter = async (
    device: BondedBluetoothDevice,
  ): Promise<SavedThermalPrinterSnapshot> => {
    const snapshot = snapshotSelectionDevice(device);
    if (snapshot === null || jobDependencies === undefined) {
      throw unexpectedThermalPrinterError();
    }

    try {
      await jobDependencies.selectionStore.save({
        name: snapshot.name,
        address: snapshot.address,
      });
      return snapshot;
    } catch {
      throw unexpectedThermalPrinterError();
    }
  };

  const selectedBondedPrinter = async (): Promise<SavedThermalPrinterSnapshot> => {
    if (jobDependencies === undefined || native === null) {
      throw unexpectedThermalPrinterError();
    }

    let loaded: SavedThermalPrinterV1 | null;
    try {
      loaded = await jobDependencies.selectionStore.load();
    } catch {
      throw unexpectedThermalPrinterError();
    }
    const selected = snapshotSavedPrinter(loaded);
    if (selected === null) throw new ThermalPrinterError('printer_not_bonded');

    let nativeDevices: unknown;
    try {
      nativeDevices = await native.getBondedDevices();
    } catch (error) {
      throw normalizeThermalPrinterError(error);
    }
    const devices = snapshotBondedDevices(nativeDevices);
    if (
      devices === null ||
      !devices.some(
        (device) => device.address.toLowerCase() === selected.address.toLowerCase(),
      )
    ) {
      throw new ThermalPrinterError('printer_not_bonded');
    }
    return selected;
  };

  const runPrintJob = async <Payload>(
    kind: ThermalPrintJobKind,
    snapshotPayload: () => Payload,
    print: (
      availableNative: ThermalPrinterNativeModule,
      printer: SavedThermalPrinterSnapshot,
      payload: Payload,
    ) => Promise<NativePrintResult>,
  ): Promise<ThermalPrintJobResult> => {
    if (thermalPrintJobInFlight) {
      throw new ThermalPrinterError('busy', 'gate');
    }
    thermalPrintJobInFlight = true;

    try {
      const payload = snapshotPayload();
      const printer = await selectedBondedPrinter();
      if (native === null) throw unexpectedThermalPrinterError();
      const nativeResult = await print(native, printer, payload);
      const progress = snapshotProgress(nativeResult);
      if (progress === null) throw unexpectedThermalPrinterError();
      return Object.freeze({ status: 'sent', kind, printer, progress });
    } catch (error) {
      throw normalizeThermalPrinterError(error);
    } finally {
      thermalPrintJobInFlight = false;
    }
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

      let state: BluetoothState;
      try {
        state = await native.getBluetoothState();
      } catch (error) {
        const code = nativeErrorCode(error);
        if (
          code !== 'permission_denied' ||
          androidApiLevel < ANDROID_BLUETOOTH_CONNECT_API_LEVEL
        ) {
          return nativeAccessFailure(code, savedPrinter);
        }

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

        try {
          state = await native.getBluetoothState();
        } catch (retryError) {
          return nativeAccessFailure(nativeErrorCode(retryError), savedPrinter);
        }
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
        return nativeAccessFailure(nativeErrorCode(error), savedPrinter);
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

    selectPrinter(device: BondedBluetoothDevice) {
      return persistPrinter(device);
    },

    changePrinter(device: BondedBluetoothDevice) {
      return persistPrinter(device);
    },

    printTicket(document: ThermalTicketDocument) {
      return runPrintJob(
        'ticket',
        () => snapshotThermalTicketDocument(document),
        (availableNative, printer, snapshot) =>
          availableNative.printTicket(printer.address, snapshot),
      );
    },

    printDiagnostic() {
      return runPrintJob(
        'diagnostic',
        thermalTicketBranding,
        (availableNative, printer, branding) =>
          availableNative.printDiagnostic(printer.address, branding),
      );
    },
  });
}
