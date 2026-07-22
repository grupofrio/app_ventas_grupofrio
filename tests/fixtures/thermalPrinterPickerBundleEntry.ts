import { ThermalPrinterPicker } from '../../src/components/domain/ThermalPrinterPicker.tsx';

const bundleProbe = globalThis as typeof globalThis & {
  __thermalPrinterPickerBundleProbe?: unknown;
};

bundleProbe.__thermalPrinterPickerBundleProbe = ThermalPrinterPicker;
