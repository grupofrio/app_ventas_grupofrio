import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifySyncFailure,
  describeSyncFailureForUser,
  excludeProtectedStockSyncItems,
  isProtectedStockSyncItem,
} from '../src/services/syncErrorClassification.ts';
import { applySaleDefinitiveClearDeferral } from '../src/services/saleDefinitiveFailure.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';

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

test('structured stock stays protected despite timeout-like business copy after a response', () => {
  for (const error of [
    Object.assign(new Error('Timeout 5 kg sin stock'), {
      code: 'insufficient_stock',
      responseReceived: true,
    }),
    Object.assign(new Error('Network request failed: Timeout 5 kg sin stock'), {
      responseReceived: true,
      httpStatus: 422,
      data: { error_code: 'insufficient_stock' },
    }),
  ]) {
    assert.deepEqual(classifySyncFailure(sale, error), terminalStockFailure);
  }
});

test('no-response and 5xx transport evidence override structured stock codes', () => {
  for (const error of [
    Object.assign(new Error('Timeout 5 kg sin stock'), {
      code: 'insufficient_stock',
      responseReceived: false,
    }),
    Object.assign(new Error('upstream stock body'), {
      responseReceived: true,
      httpStatus: 503,
      data: { error_code: 'insufficient_stock' },
    }),
  ]) {
    assert.deepEqual(classifySyncFailure(sale, error), {
      retryAutomatically: true,
      terminalStatus: 'error',
      errorCode: null,
      protectFromGenericClear: false,
    });
  }
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

test('keeps HTTP 4xx and functional rejections definitive despite network-like copy', () => {
  for (const error of [
    Object.assign(new Error('Network request failed while validating'), {
      httpStatus: 422,
      responseReceived: true,
      code: 'validation_error',
    }),
    Object.assign(new Error('Network request failed while validating'), {
      httpStatus: 422,
      responseReceived: true,
    }),
    Object.assign(new Error('Timeout value is invalid'), {
      responseReceived: true,
      code: 'validation_error',
    }),
    Object.assign(new Error('Network unavailable in session message'), {
      responseReceived: true,
      data: { error_code: 'session_expired' },
    }),
  ]) {
    const classification = classifySyncFailure(sale, error);
    assert.equal(classification.retryAutomatically, false);
    assert.equal(classification.terminalStatus, 'dead');
    assert.equal(classification.protectFromGenericClear, false);
    assert.notEqual(classification.errorCode, 'insufficient_stock');
  }
});

test('keeps compatible stock text protected after a definitive 422 without a structured code', () => {
  const error = Object.assign(new Error('Stock insuficiente para Hielo 5 kg'), {
    httpStatus: 422,
    responseReceived: true,
  });

  assert.deepEqual(classifySyncFailure(sale, error), terminalStockFailure);
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

test('builds safe GPS copy without exposing batch transport secrets', () => {
  const error = new Error(
    'Network request failed Authorization: Bearer gps-secret https://odoo.internal/gps',
  );
  const classification = classifySyncFailure({ type: 'gps' }, error);

  assert.deepEqual(classification, {
    retryAutomatically: true,
    terminalStatus: 'error',
    errorCode: null,
    protectFromGenericClear: false,
  });
  const message = describeSyncFailureForUser(error, classification);
  assert.equal(message, 'No se pudo sincronizar. Se reintentará automáticamente.');
  assert.doesNotMatch(message, /Bearer|gps-secret|odoo\.internal|https?:\/\//i);
});

test('classification and copy are total for hostile and revoked runtime errors', () => {
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      throw new Error('prototype trap secret');
    },
    get() {
      throw new Error('getter trap secret');
    },
  });
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  const hostileMessage = new Error('initial');
  Object.defineProperty(hostileMessage, 'message', {
    configurable: true,
    get() {
      throw new Error('message getter secret');
    },
  });

  for (const type of ['photo', 'gps'] as const) {
    for (const error of [hostile, revocable.proxy, hostileMessage]) {
      assert.doesNotThrow(() => {
        const classification = classifySyncFailure({ type }, error);
        assert.deepEqual(classification, {
          retryAutomatically: false,
          terminalStatus: 'dead',
          errorCode: null,
          protectFromGenericClear: false,
        });
        assert.equal(
          describeSyncFailureForUser(error, classification),
          'La operación fue rechazada y requiere atención.',
        );
      });
    }
  }
});

test('protected stock survives clear deferral and is excluded after its retry clock expires', () => {
  const protectedSale: SyncQueueItem = {
    id: 'protected-sale',
    type: 'sale_order',
    payload: { _operationId: 'protected-sale' },
    status: 'dead',
    created_at: 1,
    retries: 1,
    error_message: 'Stock insuficiente',
    error_code: 'insufficient_stock',
    priority: 1,
    next_retry_at: null,
  };
  const retryAt = 5_000;
  const deferred = applySaleDefinitiveClearDeferral(
    [protectedSale],
    protectedSale.id,
    retryAt,
  );

  assert.equal(deferred[0].status, 'error');
  assert.equal(deferred[0].error_code, 'insufficient_stock');
  assert.equal(isProtectedStockSyncItem(deferred[0]), true);
  assert.deepEqual(excludeProtectedStockSyncItems(deferred), []);
  assert(retryAt < 10_000, 'el reloj ya venció y aun así no se reenvía');

  for (const status of ['pending', 'error', 'dead'] as const) {
    const protectedInAnyStatus = { ...protectedSale, status };
    assert.equal(isProtectedStockSyncItem(protectedInAnyStatus), true);
    assert.deepEqual(excludeProtectedStockSyncItems([protectedInAnyStatus]), []);
  }
});

test('normal legacy items are not treated as protected stock', () => {
  assert.equal(isProtectedStockSyncItem({}), false);
  assert.equal(isProtectedStockSyncItem({ error_code: null }), false);
  assert.equal(isProtectedStockSyncItem({ error_code: 'validation_error' }), false);
});
