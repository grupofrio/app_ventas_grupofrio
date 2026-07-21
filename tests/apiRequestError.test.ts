import assert from 'node:assert/strict';
import test from 'node:test';

type ApiRequestErrorModule = typeof import('../src/services/apiRequestError.ts');

async function loadApiRequestError(): Promise<ApiRequestErrorModule> {
  return import(
    // @ts-ignore -- Node runs this ESM test harness directly.
    new URL('../src/services/apiRequestError.ts', import.meta.url).pathname
  );
}

test('makeApiResponseError preserves response failure metadata', async () => {
  const { makeApiResponseError } = await loadApiRequestError();
  const cause = Object.assign(new Error('La venta ya fue procesada'), {
    code: 'sale_conflict',
    data: { sale_id: 42 },
  });

  const error = makeApiResponseError(cause, 'Fallback response error', 409);

  assert.equal(error.message, 'La venta ya fue procesada');
  assert.equal(error.httpStatus, 409);
  assert.equal(error.responseReceived, true);
  assert.equal(error.code, 'sale_conflict');
  assert.deepEqual(error.data, { sale_id: 42 });
  assert.equal(error.__alreadyLogged, true);
  assert.strictEqual(error, cause);
});

test('makeApiResponseError defaults missing backend codes to api_rejection', async () => {
  const { makeApiResponseError } = await loadApiRequestError();

  const error = makeApiResponseError(new Error('Solicitud rechazada'), 'Fallback response error', 400);

  assert.equal(error.code, 'api_rejection');
});

test('makeApiResponseError safely copies a non-extensible cause', async () => {
  const { makeApiResponseError } = await loadApiRequestError();
  const cause = Object.freeze(Object.assign(new Error('Error congelado'), {
    code: 'frozen_rejection',
    data: { reason: 'duplicate' },
  }));

  const error = makeApiResponseError(cause, 'Fallback response error', 422);

  assert.notStrictEqual(error, cause);
  assert.equal(error.message, 'Error congelado');
  assert.equal(error.code, 'frozen_rejection');
  assert.deepEqual(error.data, { reason: 'duplicate' });
  assert.equal(error.httpStatus, 422);
  assert.equal(error.responseReceived, true);
  assert.equal(error.__alreadyLogged, true);
});

test('makeApiTransportError marks failures before a response and preserves timeout metadata', async () => {
  const { makeApiTransportError } = await loadApiRequestError();
  const cause = Object.assign(new Error('Tiempo de espera agotado'), {
    code: 'timeout',
    data: { timeoutMs: 45_000 },
  });

  const error = makeApiTransportError(cause);

  assert.equal(error.message, 'Tiempo de espera agotado');
  assert.equal(error.responseReceived, false);
  assert.equal(error.code, 'timeout');
  assert.deepEqual(error.data, { timeoutMs: 45_000 });
  assert.equal(error.httpStatus, undefined);
  assert.equal(Object.hasOwn(error, 'httpStatus'), false);
  assert.strictEqual(error, cause);
});

test('makeApiTransportError removes a stale HTTP status from reused Errors', async () => {
  const { makeApiTransportError } = await loadApiRequestError();
  const cause = Object.assign(new Error('Tiempo de espera agotado'), {
    code: 'timeout',
    httpStatus: 504,
  });

  const error = makeApiTransportError(cause);

  assert.equal(error.responseReceived, false);
  assert.equal(error.code, 'timeout');
  assert.equal(error.httpStatus, undefined);
  assert.equal(Object.hasOwn(error, 'httpStatus'), false);
  assert.strictEqual(error, cause);
});

test('makeApiTransportError uses message and metadata from object causes', async () => {
  const { makeApiTransportError } = await loadApiRequestError();
  const cause = {
    message: 'La conexión se cerró',
    code: 'connection_lost',
    data: { retryable: true },
  };

  const error = makeApiTransportError(cause);

  assert.equal(error.message, 'La conexión se cerró');
  assert.equal(error.code, 'connection_lost');
  assert.deepEqual(error.data, { retryable: true });
  assert.equal(error.responseReceived, false);
});

test('makeApiTransportError safely handles objects without string conversion', async () => {
  const { makeApiTransportError } = await loadApiRequestError();
  const cause = Object.create(null) as Record<string, unknown>;

  const error = makeApiTransportError(cause);

  assert.equal(error.message, 'Error de solicitud');
  assert.equal(error.responseReceived, false);
});

test('makeApiTransportError safely handles hostile string conversion', async () => {
  const { makeApiTransportError } = await loadApiRequestError();
  const cause = {
    toString(): string {
      throw new Error('hostile conversion');
    },
  };

  const error = makeApiTransportError(cause);

  assert.equal(error.message, 'Error de solicitud');
  assert.equal(error.responseReceived, false);
});

test('makeApiTransportError preserves safe Symbol descriptions', async () => {
  const { makeApiTransportError } = await loadApiRequestError();

  const error = makeApiTransportError(Symbol('request failure'));

  assert.equal(error.message, 'Symbol(request failure)');
  assert.equal(error.responseReceived, false);
});
