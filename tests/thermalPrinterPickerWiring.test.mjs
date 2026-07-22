import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const pickerPath = resolve(
  repoRoot,
  'src/components/domain/ThermalPrinterPicker.tsx',
);
const pickerSource = existsSync(pickerPath) ? readFileSync(pickerPath, 'utf8') : '';

test('provides a modal list of the already ordered paired devices', () => {
  assert.equal(
    existsSync(pickerPath),
    true,
    'ThermalPrinterPicker.tsx must exist',
  );
  assert.match(pickerSource, /\bModal\b/);
  assert.match(pickerSource, /\bFlatList\b/);
  assert.match(
    pickerSource,
    /<FlatList[\s\S]*?data=\{devices\}/,
    'the picker must consume the MP210-first order supplied by the service',
  );
  assert.doesNotMatch(
    pickerSource,
    /devices\.(?:sort|toSorted)\s*\(/,
    'the picker must not replace the service device order',
  );
});

test('renders paired-device identity and marks the supplied selection', () => {
  assert.match(pickerSource, /item\.name\s*\?\?/);
  assert.match(pickerSource, /\{item\.address\}/);
  assert.match(pickerSource, /selectedPrinter\?\.address/);
  assert.match(pickerSource, /Impresora seleccionada/);
});

test('persists only after an explicit device tap and supports cancellation', () => {
  assert.match(pickerSource, /onSelectPrinter:\s*\(/);
  assert.match(
    pickerSource,
    /onPress=\{\(\)\s*=>\s*handleSelect\(item\)\}/,
    'a device tap must be the event that triggers selection persistence',
  );
  assert.match(pickerSource, /onCancel:\s*\(\)\s*=>\s*void/);
  assert.match(pickerSource, /Cancelar/);
  assert.doesNotMatch(pickerSource, /\buseEffect\s*\(/);
  assert.doesNotMatch(pickerSource, /\.(?:prepare|selectPrinter|changePrinter)\s*\(/);
});

test('offers diagnosis only for a selected printer and delegates to the service callback', () => {
  assert.match(pickerSource, /onPrintDiagnostic:\s*\(\)/);
  assert.match(pickerSource, /Imprimir diagnóstico/);
  assert.match(pickerSource, /onPrintDiagnostic\(\)/);
  assert.match(
    pickerSource,
    /selectedPrinter\s*!==\s*null[\s\S]*Imprimir diagnóstico/,
  );
  assert.doesNotMatch(
    pickerSource,
    /SALE_TICKET_BRANDING|logoPngBase64|legalName|rfcLabel/,
    'canonical diagnostic branding belongs to the printer service, not the picker',
  );
});

test('gates the real long-sale fixture behind the development flag and printTicket callback', () => {
  assert.match(
    pickerSource,
    /import\s+\{\s*buildLongSaleThermalTicketFixture\s*\}\s+from/,
  );
  assert.match(pickerSource, /onPrintTicket:\s*\(/);
  assert.match(
    pickerSource,
    /onPrintTicket\(buildLongSaleThermalTicketFixture\(\)\)/,
  );
  assert.match(
    pickerSource,
    /typeof __DEV__\s*!==\s*['"]undefined['"]\s*&&\s*__DEV__/,
    'the development global must be guarded for non-React-Native runtimes',
  );
  assert.match(
    pickerSource,
    /isDevelopmentBuild\s*&&\s*selectedPrinter\s*!==\s*null[\s\S]*Imprimir ticket largo de prueba/,
    'the synthetic long-ticket control must not render in production',
  );
});

test('blocks repeated actions while work is pending and exposes accessible controls', () => {
  assert.match(pickerSource, /loading\?:\s*boolean/);
  assert.match(pickerSource, /actionInFlightRef/);
  assert.match(pickerSource, /disabled=\{isBusy/);
  assert.match(pickerSource, /accessibilityRole="button"/);
  assert.match(pickerSource, /accessibilityState=\{\{\s*disabled:/);
});
