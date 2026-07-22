import { requireOptionalNativeModule } from 'expo-modules-core';

export type BluetoothState = 'unsupported' | 'off' | 'on';

export type BondedBluetoothDevice = {
  name: string | null;
  address: string;
};

export interface ThermalPrinterNativeModule {
  getBluetoothState(): Promise<BluetoothState>;
  getBondedDevices(): Promise<BondedBluetoothDevice[]>;
}

const ThermalPrinterModule: ThermalPrinterNativeModule | null =
  requireOptionalNativeModule<ThermalPrinterNativeModule>('KoldThermalPrinter');

export default ThermalPrinterModule;
