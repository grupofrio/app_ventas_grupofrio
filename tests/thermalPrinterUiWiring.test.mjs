import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const screenSource = readFileSync(
  resolve(process.cwd(), 'app/print/[orderId].tsx'),
  'utf8',
);

test('button composes the real MP210 service without asking permission on mount', () => {
  assert.match(screenSource, /import\s+ThermalPrinterModule\s+from\s+['"]\.\.\/\.\.\/modules\/thermal-printer/);
  assert.match(screenSource, /createThermalPrinterService/);
  assert.match(screenSource, /createThermalPrinterSelectionStore/);
  assert.match(screenSource, /Platform\.Version/);
  assert.match(screenSource, /PermissionsAndroid\.PERMISSIONS\.BLUETOOTH_CONNECT/);
  assert.match(screenSource, /PermissionsAndroid\.RESULTS\.GRANTED/);
  assert.match(screenSource, /PermissionsAndroid\.RESULTS\.DENIED/);
  assert.match(screenSource, /PermissionsAndroid\.RESULTS\.NEVER_ASK_AGAIN/);
  assert.match(screenSource, /label="Imprimir en MP210"/);

  const effectBodies = [...screenSource.matchAll(/React\.useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[[^\]]*\]\);/g)]
    .map((match) => match[1]);
  assert.ok(effectBodies.some((body) => body.includes('selectionStore.load()')));
  assert.ok(effectBodies.every((body) => !body.includes('.prepare(')));
  assert.ok(effectBodies.every((body) => !body.includes('PermissionsAndroid.request(')));
});

test('selection UI shows printer identity, opens the picker, and persists explicit changes', () => {
  assert.match(screenSource, /ThermalPrinterPicker/);
  assert.match(screenSource, /selectedPrinter\.name\s*\?\?/);
  assert.match(screenSource, /selectedPrinter\.address/);
  assert.match(screenSource, /Cambiar impresora/);
  assert.match(screenSource, /status\s*!==\s*['"]ready['"]/);
  assert.match(screenSource, /savedPrinterBonded/);
  assert.match(screenSource, /setPickerVisible\(true\)/);
  assert.match(screenSource, /\.selectPrinter\(/);
  assert.match(screenSource, /\.changePrinter\(/);
  assert.match(screenSource, /onCancel=\{[^}]+\}/);
  assert.match(screenSource, /onActionError=\{[^}]+\}/);
});

test('success and PDF states use sent copy and disable both output actions during jobs', () => {
  assert.match(screenSource, /type\s+PrinterJobState\s*=\s*['"]idle['"]\s*\|\s*['"]permission['"]\s*\|\s*['"]connecting['"]\s*\|\s*['"]sending['"]/);
  assert.match(screenSource, /Ticket enviado a MP210/);
  assert.match(screenSource, /Diagn[oó]stico enviado a MP210/);
  assert.doesNotMatch(screenSource, /Ticket impreso|Diagn[oó]stico impreso/);
  assert.match(screenSource, /label="Abrir PDF"/);
  assert.match(screenSource, /disabled=\{isPrintJobActive/);
  assert.match(screenSource, /ActivityIndicator/);
  assert.match(screenSource, /Conectando|Enviando|permiso/i);
  assert.match(screenSource, /buildThermalTicketDocument\(ticket/);
});

test('access failures keep PDF useful and permanent denial offers Android settings', () => {
  for (const status of [
    'permission_denied',
    'permission_permanently_denied',
    'bluetooth_off',
    'bluetooth_unsupported',
    'native_unavailable',
    'unsupported_platform',
  ]) {
    assert.match(screenSource, new RegExp(`case ['"]${status}['"]`));
  }
  assert.match(screenSource, /Linking\.openSettings\(\)/);
  assert.match(screenSource, /nueva (?:compilaci[oó]n|versi[oó]n) de Android/i);
  assert.match(screenSource, /PDF (?:sigue|permanece) disponible/i);
  assert.match(screenSource, /ya no est[aá] vinculada|elige otra/i);
});

test('partial raster failures require an explicit fresh reprint and never auto retry', () => {
  assert.match(screenSource, /error\s+instanceof\s+ThermalPrinterError/);
  assert.match(screenSource, /error\.progress\.rasterPayloadAttempted/);
  assert.match(screenSource, /El ticket pudo salir incompleto/);
  assert.match(screenSource, /text:\s*['"]Cancelar['"]/);
  assert.match(screenSource, /text:\s*['"]Reimprimir['"]/);
  assert.match(screenSource, /onPress:\s*\(\)\s*=>\s*\{?\s*void\s+retry/);
  assert.match(screenSource, /jobInFlightRef\.current/);

  assert.doesNotMatch(
    screenSource,
    /if\s*\(error\.progress\.rasterPayloadAttempted\)\s*\{\s*(?:await|void)\s+retry\s*\(/,
    'the raster-attempt branch must present the Alert before any explicit retry callback can run',
  );
});

test('picker diagnostics and debug tickets delegate to the service and guard stale work', () => {
  assert.match(screenSource, /onPrintDiagnostic=\{[^}]+\}/);
  assert.match(screenSource, /onPrintTicket=\{[^}]+\}/);
  assert.match(screenSource, /thermalPrinterService\.printDiagnostic\(\)/);
  assert.match(screenSource, /thermalPrinterService\.printTicket\(/);
  assert.doesNotMatch(screenSource, /buildLongSaleThermalTicketFixture|VENTA-MP210-LARGA-001/);
  assert.match(screenSource, /mountedRef\.current/);
  assert.match(screenSource, /operationIdRef\.current/);
  assert.match(screenSource, /jobInFlightRef\.current/);
});

test('cross-output guards reject same-frame PDF and Bluetooth double taps', () => {
  const openPdfBody = screenSource.match(
    /async function handleOpenPdf\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*function startPrinterOperation/,
  )?.[1] ?? '';
  const startPrinterBody = screenSource.match(
    /function startPrinterOperation\([^)]*\)[^{]*\{([\s\S]*?)\n\s*\}\n\n\s*function isCurrentOperation/,
  )?.[1] ?? '';
  assert.match(openPdfBody, /jobInFlightRef\.current/);
  assert.match(startPrinterBody, /pdfInFlightRef\.current/);
});
