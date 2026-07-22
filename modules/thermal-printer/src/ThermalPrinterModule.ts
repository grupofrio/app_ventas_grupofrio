import { requireOptionalNativeModule } from 'expo-modules-core';
import type {
  NativePrintResult,
  ThermalTicketDocument,
} from '../../../src/services/thermalPrinterTypes';

export type {
  NativePrintResult,
  ThermalTicketDocument,
} from '../../../src/services/thermalPrinterTypes';

export type ThermalTicketBranding = ThermalTicketDocument['branding'];

export type BluetoothState = 'unsupported' | 'off' | 'on';

export type BondedBluetoothDevice = {
  name: string | null;
  address: string;
};

export interface ThermalPrinterNativeModule {
  getBluetoothState(): Promise<BluetoothState>;
  getBondedDevices(): Promise<BondedBluetoothDevice[]>;
  printTicket(
    address: string,
    document: ThermalTicketDocument,
  ): Promise<NativePrintResult>;
  printDiagnostic(
    address: string,
    branding: ThermalTicketBranding,
  ): Promise<NativePrintResult>;
}

const ThermalPrinterModule: ThermalPrinterNativeModule | null =
  requireOptionalNativeModule<ThermalPrinterNativeModule>('KoldThermalPrinter');

export default ThermalPrinterModule;
