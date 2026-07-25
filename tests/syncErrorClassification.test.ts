import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifySyncFailure,
  describeSyncFailureForUser,
} from '../src/services/syncErrorClassification.ts';

const sale = { type: 'sale_order' as const };

const terminalStockFailure = {
  retryAutomatically: false,
  terminalStatus: 'dead',
  errorCode: 'insufficient_stock',
  protectFromGenericClear: true,
} as const;

test('classifies top-level insufficient_stock as a protected terminal sale failure', () => {
  const error = Object.assign(new Error('raw backend rejection'), {
    code: 'insufficient_stock',
    responseReceived: true,
  });

  assert.deepEqual(classifySyncFailure(sale, error), terminalStockFailure);
});

test('classifies data.error_code insufficient_stock as a protected terminal sale failure', () => {
  const error = Object.assign(new Error('request rejected'), {
    data: { error_code: 'insufficient_stock' },
    responseReceived: true,
  });

  assert.deepEqual(classifySyncFailure(sale, error), terminalStockFailure);
});

test('reuses the compatible insufficient-stock parser without requiring a structured code', () => {
  assert.deepEqual(
    classifySyncFailure(sale, new Error('Stock insuficiente para completar la venta')),
    terminalStockFailure,
  );
});

test('keeps ambiguous sale and network failures automatically retryable', () => {
  for (const error of [
    Object.assign(new Error('timed out'), { code: 'timeout', responseReceived: false }),
    new Error('Network request failed'),
    Object.assign(new Error('server unavailable'), { httpStatus: 503, responseReceived: true }),
    Object.assign(new Error('upstream failed with stock text'), {
      httpStatus: 503,
      responseReceived: true,
      code: 'insufficient_stock',
      data: { error_code: 'insufficient_stock' },
    }),
    Object.assign(new Error('Stock insuficiente before response'), {
      responseReceived: false,
      code: 'insufficient_stock',
    }),
    new Error('Network request failed: stock insuficiente para completar la venta'),
    new Error('Timeout al enviar: stock insuficiente'),
  ]) {
    assert.deepEqual(classifySyncFailure(sale, error), {
      retryAutomatically: true,
      terminalStatus: 'error',
      errorCode: null,
      protectFromGenericClear: false,
    });
  }
});

test('keeps other definitive sale rejections terminal without protecting generic cleanup', () => {
  const error = Object.assign(new Error('validation rejected'), {
    httpStatus: 422,
    responseReceived: true,
    code: 'validation_error',
  });

  assert.deepEqual(classifySyncFailure(sale, error), {
    retryAutomatically: false,
    terminalStatus: 'dead',
    errorCode: 'validation_error',
    protectFromGenericClear: false,
  });
});

test('uses the existing non-sale retry behavior', () => {
  assert.deepEqual(classifySyncFailure({ type: 'photo' }, new Error('Network request failed')), {
    retryAutomatically: true,
    terminalStatus: 'error',
    errorCode: null,
    protectFromGenericClear: false,
  });
  assert.deepEqual(classifySyncFailure({ type: 'photo' }, new Error('unknown')), {
    retryAutomatically: false,
    terminalStatus: 'dead',
    errorCode: null,
    protectFromGenericClear: false,
  });
});

test('builds bounded human-readable stock detail without exposing the raw error', () => {
  const error = Object.assign(
    new Error('Authorization: Bearer super-secret https://odoo.internal/debug'),
    {
      code: 'insufficient_stock',
      responseReceived: true,
      data: {
        error_code: 'insufficient_stock',
        lines: [
          {
            product_id: 9,
            product_name: 'Hielo 5 kg',
            requested_qty: 4,
            available_qty: 1,
          },
        ],
      },
    },
  );

  const message = describeSyncFailureForUser(error, terminalStockFailure);
  assert.match(message, /Hielo 5 kg/);
  assert.match(message, /pediste 4, disponible 1/);
  assert.doesNotMatch(message, /Bearer|super-secret|odoo\.internal/i);
  assert(message.length <= 500);
});

test('never exposes raw validation or network diagnostics in the persisted user message', () => {
  const validation = Object.assign(
    new Error('Authorization: Bearer validation-secret https://odoo.internal/trace'),
    { httpStatus: 422, responseReceived: true, code: 'validation_error' },
  );
  const network = new Error(
    'Network request failed Authorization: Bearer network-secret https://odoo.internal/trace',
  );

  const validationMessage = describeSyncFailureForUser(
    validation,
    classifySyncFailure(sale, validation),
  );
  const networkMessage = describeSyncFailureForUser(
    network,
    classifySyncFailure(sale, network),
  );

  assert.equal(validationMessage, 'La operación fue rechazada y requiere atención.');
  assert.equal(networkMessage, 'No se pudo sincronizar. Se reintentará automáticamente.');
  for (const message of [validationMessage, networkMessage]) {
    assert.doesNotMatch(message, /Bearer|secret|odoo\.internal|https?:\/\//i);
  }
});
