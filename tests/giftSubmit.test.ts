/**
 * Regalo offline: decisión de fallo + idempotencia del payload.
 */
import assert from 'node:assert/strict';

interface DecideMod {
  decideGiftFailureAction: (input: { isSessionExpired: boolean; isRetryable: boolean }) => string;
}
interface PayloadMod {
  buildGiftPayload: (input: any) => any;
}

function runDecide(m: DecideMod) {
  // Sesión expirada → re-login, NUNCA encolar (aunque sea retryable).
  assert.equal(m.decideGiftFailureAction({ isSessionExpired: true, isRetryable: true }), 'session_relogin');
  assert.equal(m.decideGiftFailureAction({ isSessionExpired: true, isRetryable: false }), 'session_relogin');
  // Red/retryable → encolar.
  assert.equal(m.decideGiftFailureAction({ isSessionExpired: false, isRetryable: true }), 'enqueue');
  // Validación/backend → mostrar error, NO encolar.
  assert.equal(m.decideGiftFailureAction({ isSessionExpired: false, isRetryable: false }), 'show_error');
  console.log('gift submit decision tests: ok');
}

function runPayload(m: PayloadMod) {
  const base = {
    analyticAccountId: 5,
    mobileLocationId: 9,
    partnerId: 100,
    visitLineId: 7,
    lines: [{ productId: 1, qty: 2 }],
    notes: 'muestra',
  };
  // idempotency_key (operation_id) presente y estable para retry con mismo id.
  const p1 = m.buildGiftPayload({ ...base, idempotencyKey: 'gift-9-123-abc' });
  assert.equal(p1.meta.idempotency_key, 'gift-9-123-abc');
  assert.equal(p1.data.partner_id, 100);
  assert.deepEqual(p1.data.lines, [{ product_id: 1, qty: 2 }]);

  const retry = m.buildGiftPayload({ ...base, idempotencyKey: 'gift-9-123-abc' });
  assert.deepEqual(retry, p1, 'retry con mismo idempotencyKey produce payload idéntico (idempotente)');

  const other = m.buildGiftPayload({ ...base, idempotencyKey: 'gift-9-999-zzz' });
  assert.notEqual(other.meta.idempotency_key, p1.meta.idempotency_key);
  console.log('gift payload idempotency tests: ok');
}

async function main() {
  const decide = await import(
    // @ts-ignore
    new URL('../src/services/giftSubmit.ts', import.meta.url).pathname
  ) as unknown as DecideMod;
  const payload = await import(
    // @ts-ignore
    new URL('../src/services/giftPayload.ts', import.meta.url).pathname
  ) as unknown as PayloadMod;
  runDecide(decide);
  runPayload(payload);
}
void main();
