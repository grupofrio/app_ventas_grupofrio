import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginOutput,
  createExplicitReprintAction,
  createOutputGate,
  createThermalPrinterScreenFlowState,
  isCurrentOutput,
  openSettingsSafely,
  reduceThermalPrinterScreenFlow,
  releaseOutput,
} from '../src/services/thermalPrinterScreenFlow.ts';

const printer = Object.freeze({
  version: 1 as const,
  name: 'MP210',
  address: 'AA:BB:CC:DD:EE:FF',
});

test('same-frame output gate accepts only one PDF or printer operation', () => {
  const initial = createOutputGate();
  const first = beginOutput(initial, 'printer');
  assert.notEqual(first.token, null);
  assert.equal(isCurrentOutput(first.gate, first.token!), true);

  const competingPdf = beginOutput(first.gate, 'pdf');
  assert.equal(competingPdf.token, null);
  assert.equal(competingPdf.gate, first.gate);

  const pdfFirst = beginOutput(createOutputGate(), 'pdf');
  assert.notEqual(pdfFirst.token, null);
  assert.equal(beginOutput(pdfFirst.gate, 'printer').token, null);
});

test('stale cleanup never releases a newer operation and current cleanup releases its gate', () => {
  const first = beginOutput(createOutputGate(), 'printer');
  const idleAgain = releaseOutput(first.gate, first.token!);
  const second = beginOutput(idleAgain, 'printer');
  assert.notEqual(second.token, null);

  const staleCleanup = releaseOutput(second.gate, first.token!);
  assert.equal(isCurrentOutput(staleCleanup, second.token!), true);

  const currentCleanup = releaseOutput(staleCleanup, second.token!);
  assert.equal(isCurrentOutput(currentCleanup, second.token!), false);
  assert.notEqual(beginOutput(currentCleanup, 'pdf').token, null);
});

test('flow exposes permission, connecting, and sending before returning to idle', () => {
  let state = createThermalPrinterScreenFlowState();
  state = reduceThermalPrinterScreenFlow(state, { type: 'job_state', value: 'permission' });
  assert.equal(state.jobState, 'permission');
  state = reduceThermalPrinterScreenFlow(state, { type: 'job_state', value: 'connecting' });
  assert.equal(state.jobState, 'connecting');
  state = reduceThermalPrinterScreenFlow(state, { type: 'job_state', value: 'sending' });
  assert.equal(state.jobState, 'sending');
  state = reduceThermalPrinterScreenFlow(state, { type: 'job_finished' });
  assert.equal(state.jobState, 'idle');
});

test('persisted selection updates identity while picker remains open for diagnosis', () => {
  let state = createThermalPrinterScreenFlowState();
  state = reduceThermalPrinterScreenFlow(state, { type: 'picker_opened' });
  state = reduceThermalPrinterScreenFlow(state, { type: 'printer_selected', printer });

  assert.deepEqual(state.selectedPrinter, printer);
  assert.equal(state.pickerVisible, true);

  const changedPrinter = Object.freeze({
    version: 1 as const,
    name: 'MP210 caja 2',
    address: '11:22:33:44:55:66',
  });
  state = reduceThermalPrinterScreenFlow(state, {
    type: 'printer_selected',
    printer: changedPrinter,
  });
  assert.deepEqual(state.selectedPrinter, changedPrinter);
  assert.equal(state.pickerVisible, true);

  state = reduceThermalPrinterScreenFlow(state, { type: 'picker_closed' });
  assert.equal(state.pickerVisible, false);
});

test('partial raster decision never retries until the captured Reimprimir action is invoked', async () => {
  let attempts = 0;
  const decision = createExplicitReprintAction(
    { rasterPayloadAttempted: true },
    async () => { attempts += 1; },
  );

  assert.notEqual(decision, null);
  assert.equal(attempts, 0);
  await decision!.reprint();
  assert.equal(attempts, 1);

  const safeFailure = createExplicitReprintAction(
    { rasterPayloadAttempted: false },
    async () => { attempts += 1; },
  );
  assert.equal(safeFailure, null);
  assert.equal(attempts, 1);
});

test('settings rejection is caught without exposing the rejected error', async () => {
  const privateError = new Error('private Android settings failure');
  let fallbackCalls = 0;

  await assert.doesNotReject(() => openSettingsSafely(
    async () => { throw privateError; },
    () => { fallbackCalls += 1; },
  ));
  assert.equal(fallbackCalls, 1);
});
