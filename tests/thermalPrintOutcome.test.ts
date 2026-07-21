import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requiresManualReprintConfirmation,
  type NativePrintProgress,
} from '../src/services/thermalPrinterTypes.ts';

test('manual confirmation depends only on whether raster payload was attempted', () => {
  const attemptedWithNoConfirmedBytes: NativePrintProgress = {
    transportBytesWritten: 8,
    rasterBytesWritten: 0,
    bandsCompleted: 0,
    rasterPayloadAttempted: true,
  };
  const notAttempted: NativePrintProgress = {
    transportBytesWritten: 2,
    rasterBytesWritten: 0,
    bandsCompleted: 0,
    rasterPayloadAttempted: false,
  };

  assert.equal(requiresManualReprintConfirmation(attemptedWithNoConfirmedBytes), true);
  assert.equal(requiresManualReprintConfirmation(notAttempted), false);
});

test('confirmed raster byte counts never override the conservative partial-print policy', () => {
  const attempted: NativePrintProgress = {
    transportBytesWritten: 0,
    rasterBytesWritten: 0,
    bandsCompleted: 0,
    rasterPayloadAttempted: true,
  };
  const notAttemptedDespiteBytes: NativePrintProgress = {
    transportBytesWritten: 64,
    rasterBytesWritten: 56,
    bandsCompleted: 1,
    rasterPayloadAttempted: false,
  };

  assert.equal(requiresManualReprintConfirmation(attempted), true);
  assert.equal(requiresManualReprintConfirmation(notAttemptedDespiteBytes), false);
});
