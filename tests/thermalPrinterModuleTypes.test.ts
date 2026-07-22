import assert from 'node:assert/strict';
import test from 'node:test';

import type ThermalPrinterModule from '../modules/thermal-printer/index.ts';
import type {
  BluetoothState,
  BondedBluetoothDevice,
  NativePrintResult,
  ThermalTicketBranding,
  ThermalTicketDocument,
  ThermalPrinterNativeModule,
} from '../modules/thermal-printer/index.ts';

type Assert<Type extends true> = Type;
type IsAny<Type> = 0 extends 1 & Type ? true : false;
type IsExact<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2)
    ? (<Type>() => Type extends Right ? 1 : 2) extends
        (<Type>() => Type extends Left ? 1 : 2)
      ? true
      : false
    : false;

type BoundaryType = typeof ThermalPrinterModule;
type ExpectedBluetoothState = 'unsupported' | 'off' | 'on';
type ExpectedBondedBluetoothDevice = {
  name: string | null;
  address: string;
};
type ExpectedThermalPrinterNativeModule = {
  getBluetoothState(): Promise<ExpectedBluetoothState>;
  getBondedDevices(): Promise<ExpectedBondedBluetoothDevice[]>;
  printTicket(address: string, document: ThermalTicketDocument): Promise<NativePrintResult>;
  printDiagnostic(address: string, branding: ThermalTicketBranding): Promise<NativePrintResult>;
};
type ExpectedNativePrintResult = {
  transportBytesWritten: number;
  rasterBytesWritten: number;
  bandsCompleted: number;
  rasterPayloadAttempted: boolean;
};
type ExpectedThermalTicketBranding = ThermalTicketDocument['branding'];

type _BluetoothStateIsExact = Assert<
  IsExact<BluetoothState, ExpectedBluetoothState>
>;
type _BondedDeviceIsExact = Assert<
  IsExact<BondedBluetoothDevice, ExpectedBondedBluetoothDevice>
>;
type _NativeModuleIsExact = Assert<
  IsExact<ThermalPrinterNativeModule, ExpectedThermalPrinterNativeModule>
>;
type _NativePrintResultIsExact = Assert<
  IsExact<NativePrintResult, ExpectedNativePrintResult>
>;
type _ThermalTicketBrandingIsExact = Assert<
  IsExact<ThermalTicketBranding, ExpectedThermalTicketBranding>
>;
type _BoundaryIsNotAny = Assert<IsAny<BoundaryType> extends false ? true : false>;
type _BoundaryIsExact = Assert<
  IsExact<BoundaryType, ThermalPrinterNativeModule | null>
>;

function assertNullable(module: BoundaryType) {
  // @ts-expect-error The optional native boundary must be narrowed before use.
  const available: ThermalPrinterNativeModule = module;
  void available;
}

async function assertExactMethods(module: NonNullable<BoundaryType>) {
  const state: BluetoothState = await module.getBluetoothState();
  const devices: BondedBluetoothDevice[] = await module.getBondedDevices();
  const document = {} as ThermalTicketDocument;
  const result: NativePrintResult = await module.printTicket('AA:BB:CC:DD:EE:FF', document);
  const diagnostic: NativePrintResult = await module.printDiagnostic(
    'AA:BB:CC:DD:EE:FF',
    document.branding,
  );
  const nullableName: string | null = devices[0]!.name;

  if (devices[0]!.name !== null) {
    const narrowedName: string = devices[0]!.name;
    void narrowedName;
  }

  // @ts-expect-error There is no generic print API.
  module.print();
  // @ts-expect-error Scanning is deliberately outside the bonded-device API.
  module.scanForDevices();
  // @ts-expect-error The state method has one exact name.
  module.bluetoothState();

  void state;
  void result;
  void diagnostic;
  void nullableName;
}

void assertNullable;
void assertExactMethods;

test('thermal printer boundary keeps its compile-time contract', () => {
  assert.ok(true);
});
