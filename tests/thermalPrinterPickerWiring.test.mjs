import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = process.cwd();
const pickerPath = resolve(
  repoRoot,
  'src/components/domain/ThermalPrinterPicker.tsx',
);
const debugControlsPath = resolve(
  repoRoot,
  'src/components/domain/ThermalPrinterPickerDebugControls.tsx',
);
const pickerSource = existsSync(pickerPath) ? readFileSync(pickerPath, 'utf8') : '';
const debugControlsSource = existsSync(debugControlsPath)
  ? readFileSync(debugControlsPath, 'utf8')
  : '';

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
  assert.doesNotMatch(
    pickerSource,
    /import\s+\{\s*buildLongSaleThermalTicketFixture\s*\}\s+from/,
    'a static fixture import would retain customer-like debug data in production',
  );
  assert.match(
    pickerSource,
    /require\(\s*['"]\.\/ThermalPrinterPickerDebugControls\.tsx['"]\s*\)/,
    'the complete debug control must be composed only from the development branch',
  );
  assert.equal(existsSync(debugControlsPath), true);
  assert.match(
    debugControlsSource,
    /import\s+\{\s*buildLongSaleThermalTicketFixture\s*\}\s+from/,
    'the development-only control must use the real sale fixture',
  );
  assert.match(pickerSource, /onPrintTicket:\s*\(/);
  assert.match(
    debugControlsSource,
    /onPrintTicket\(buildLongSaleThermalTicketFixture\(\)\)/,
  );
  assert.match(
    pickerSource,
    /typeof __DEV__\s*!==\s*['"]undefined['"]\s*&&\s*__DEV__/,
    'the development global must be guarded for non-React-Native runtimes',
  );
  assert.match(
    pickerSource,
    /ThermalPrinterPickerDebugControls\s*!==\s*null\s*&&\s*selectedPrinter\s*!==\s*null/,
    'the debug component must not be constructed when production composition is null',
  );
  assert.match(debugControlsSource, /Imprimir ticket largo de prueba/);
});

test('includes the real long-sale flow only in an Android development bundle', {
  timeout: 60_000,
}, () => {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'mp210-picker-production-'));
  const productionBundlePath = resolve(outputRoot, 'index.production.android.bundle');
  const developmentBundlePath = resolve(outputRoot, 'index.development.android.bundle');
  const buildBundle = (dev, minify, bundlePath, assetsDirectory) => spawnSync(
    resolve(repoRoot, 'node_modules/.bin/expo'),
    [
      'export:embed',
      '--platform',
      'android',
      '--dev',
      String(dev),
      '--minify',
      String(minify),
      '--entry-file',
      'tests/fixtures/thermalPrinterPickerBundleEntry.ts',
      '--bundle-output',
      bundlePath,
      '--assets-dest',
      resolve(outputRoot, assetsDirectory),
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    },
  );

  try {
    const productionBundle = buildBundle(
      false,
      true,
      productionBundlePath,
      'production-assets',
    );
    assert.equal(
      productionBundle.status,
      0,
      `production bundle failed:\n${productionBundle.stdout}\n${productionBundle.stderr}`,
    );

    const productionSource = readFileSync(productionBundlePath, 'utf8');
    for (const debugMarker of [
      'VENTA-MP210-LARGA-001',
      'Cliente de prueba con nombre largo',
      'Imprimir ticket largo de prueba',
    ]) {
      assert.equal(
        productionSource.includes(debugMarker),
        false,
        `Android production bundle must not include debug marker: ${debugMarker}`,
      );
    }

    const developmentBundle = buildBundle(
      true,
      false,
      developmentBundlePath,
      'development-assets',
    );
    assert.equal(
      developmentBundle.status,
      0,
      `development bundle failed:\n${developmentBundle.stdout}\n${developmentBundle.stderr}`,
    );
    const developmentSource = readFileSync(developmentBundlePath, 'utf8');
    for (const debugMarker of [
      'VENTA-MP210-LARGA-001',
      'Cliente de prueba con nombre largo',
      'Imprimir ticket largo de prueba',
    ]) {
      assert.equal(
        developmentSource.includes(debugMarker),
        true,
        `Android development bundle must include real debug marker: ${debugMarker}`,
      );
    }
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('blocks repeated actions while work is pending and exposes accessible controls', () => {
  assert.match(pickerSource, /loading\?:\s*boolean/);
  assert.match(pickerSource, /actionInFlightRef/);
  assert.match(pickerSource, /disabled=\{isBusy/);
  assert.match(pickerSource, /accessibilityRole="button"/);
  assert.match(pickerSource, /accessibilityState=\{\{\s*disabled:/);
});
