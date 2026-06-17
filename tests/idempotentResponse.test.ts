/**
 * Respuestas idempotentes #116: already_closed / already_confirmed se reconocen
 * por code o por mensaje, y NO se confunden con otros errores.
 */
import assert from 'node:assert/strict';

interface Mod {
  isAlreadyClosedResponse: (code?: string | null, message?: string | null) => boolean;
  isAlreadyConfirmedResponse: (code?: string | null, message?: string | null) => boolean;
}

function run(m: Mod) {
  // already_closed por code.
  assert.equal(m.isAlreadyClosedResponse('already_closed', null), true);
  // por mensaje (fallback si el code no llega).
  assert.equal(m.isAlreadyClosedResponse(undefined, 'Route already closed'), true);
  assert.equal(m.isAlreadyClosedResponse(null, 'La ruta ya estaba cerrada'), true);
  // NO confundir con otros.
  assert.equal(m.isAlreadyClosedResponse('insufficient_stock', 'stock'), false);
  assert.equal(m.isAlreadyClosedResponse(null, null), false);
  assert.equal(m.isAlreadyClosedResponse('already_confirmed', null), false, 'closed != confirmed');

  // already_confirmed por code.
  assert.equal(m.isAlreadyConfirmedResponse('already_confirmed', null), true);
  // por mensaje.
  assert.equal(m.isAlreadyConfirmedResponse(undefined, 'Liquidation already confirmed'), true);
  assert.equal(m.isAlreadyConfirmedResponse(null, 'La liquidación ya estaba confirmada'), true);
  // NO confundir.
  assert.equal(m.isAlreadyConfirmedResponse('difference_warning', 'hay diferencia'), false);
  assert.equal(m.isAlreadyConfirmedResponse('already_closed', null), false, 'confirmed != closed');

  console.log('idempotent response tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta solo en runtime de test.
    new URL('../src/services/idempotentResponse.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
