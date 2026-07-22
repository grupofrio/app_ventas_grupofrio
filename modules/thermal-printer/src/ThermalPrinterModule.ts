import { requireOptionalNativeModule } from 'expo-modules-core';

const ThermalPrinterModule = requireOptionalNativeModule('KoldThermalPrinter');

export default ThermalPrinterModule;
