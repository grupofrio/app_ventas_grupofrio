import { requireOptionalNativeModule } from 'expo-modules-core';

export type ThermalPrinterNativeModule = Record<never, never>;

const ThermalPrinterModule: ThermalPrinterNativeModule | null =
  requireOptionalNativeModule<ThermalPrinterNativeModule>('KoldThermalPrinter');

export default ThermalPrinterModule;
