import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIELD_EVENT_PATH,
  buildOperationFailureReport,
  enqueueOperationFailure,
  operationNameForSyncType,
  readFailureError,
} from '../src/services/operationFailureReportLogic.ts';

test('a rejection keeps the server code and message with seller, stop and time', () => {
  const report = buildOperationFailureReport({
    operation: 'exchange',
    operationId: 'op-1',
    stopId: 1044,
    error: {
      code: 'FORBIDDEN',
      reason: 'VAN_OTHER_BRANCH',
      message: 'La van no pertenece a la sucursal activa.',
    },
    outcome: 'rejected',
  }, 'Alvaro Garcia', '2026-10-09T14:16:00.000Z');
  assert.deepEqual(report, {
    occurred_at: '2026-10-09T14:16:00.000Z',
    operation: 'exchange',
    operation_id: 'op-1',
    stop_id: 1044,
    stop_ref: '1044',
    seller_name: 'Alvaro Garcia',
    plan_id: null,
    error_code: 'FORBIDDEN:VAN_OTHER_BRANCH',
    error_message: 'La van no pertenece a la sucursal activa.',
    outcome: 'rejected',
  });
  assert.equal('employee_id' in (report ?? {}), false);
  assert.equal('company_id' in (report ?? {}), false);
});

test('a virtual stop is not sent as a server stop id', () => {
  const report = buildOperationFailureReport({
    operation: 'offroute',
    stopId: -3,
    error: { code: 'VALIDATION_ERROR', message: 'Parada no existe' },
    outcome: 'rejected',
  }, '', '2026-10-09T14:16:00.000Z');
  assert.equal(report?.stop_id, null);
  assert.equal(report?.stop_ref, '-3');
  assert.equal(report?.seller_name, null);
});

test('dead sync items keep the exact message and collapse duplicates', () => {
  assert.equal(operationNameForSyncType('sale_order'), 'sale');
  assert.equal(operationNameForSyncType('photo'), 'photo');
  assert.deepEqual(readFailureError(new Error('La imagen no es válida')), {
    code: 'APP_ERROR',
    message: 'La imagen no es válida',
  });
  const report = buildOperationFailureReport({
    operation: 'photo',
    operationId: 'photo-1',
    stopId: 9,
    error: { message: 'La imagen no es válida' },
    outcome: 'dead',
  }, 'Alvaro Garcia', '2026-10-09T14:16:00.000Z');
  assert.ok(report);
  const queued = enqueueOperationFailure(enqueueOperationFailure([], report!), report!);
  assert.equal(queued.length, 1);
});

test('field events use a dedicated employee endpoint', () => {
  assert.equal(FIELD_EVENT_PATH, 'gf/logistics/api/employee/field-events');
});
