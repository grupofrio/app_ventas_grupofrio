/**
 * Copy offline de flujos secundarios: honesto (nunca "registrado/confirmado"
 * antes de Odoo) y consistente (bloqueo explica el porqué).
 */
import assert from 'node:assert/strict';

interface Mod {
  consignmentOfflineBlockMessage: () => { title: string; body: string };
  presaleOfflineBlockMessage: () => { title: string; body: string };
  presaleQueuedMessage: () => { title: string; body: string };
  insufficientStockActionHint: () => string;
}

function run(m: Mod) {
  // Consignación: offline capture copy (pending sync, not "confirmado").
  const consign = m.consignmentOfflineBlockMessage();
  assert.match(consign.title, /sin conexión/i);
  assert.match(consign.body, /local|sincronizar|señal/i);
  assert.doesNotMatch(consign.body, /confirmad/i);

  // Preventa: búsqueda de cliente puede requerir red; captura offline se permite
  // cuando el cliente ya está seleccionado (mensaje ya no bloquea cotización).
  const presale = m.presaleOfflineBlockMessage();
  assert.match(presale.title, /sin conexión/i);
  assert.match(presale.body, /buscar|cliente|sincronizar/i);
  assert.doesNotMatch(presale.body, /\bregistrad[ao]\b/i);

  const queued = m.presaleQueuedMessage();
  assert.match(queued.title, /pendiente/i);
  assert.match(queued.body, /sincronizar/i);
  assert.doesNotMatch(queued.body, /\bcreada\b/i);

  // insufficient_stock: deja claro que NO se confirmó + acción.
  const hint = m.insufficientStockActionHint();
  assert.match(hint, /NO se ha confirmado/i);
  assert.match(hint, /ajusta|elimina/i);

  console.log('secondary flow copy tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta solo en runtime de test.
    new URL('../src/services/secondaryFlowCopy.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
