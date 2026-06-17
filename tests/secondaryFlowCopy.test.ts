/**
 * Copy offline de flujos secundarios: honesto (nunca "registrado/confirmado"
 * antes de Odoo) y consistente (bloqueo explica el porqué).
 */
import assert from 'node:assert/strict';

interface Mod {
  refillSavedMessage: () => { title: string; body: string };
  consignmentOfflineBlockMessage: () => { title: string; body: string };
  presaleOfflineBlockMessage: () => { title: string; body: string };
  insufficientStockActionHint: () => string;
}

function run(m: Mod) {
  // Refill: encola → "guardada", NO "registrada/confirmada/enviada".
  const refill = m.refillSavedMessage();
  assert.match(refill.title, /guardad/i);
  assert.match(refill.body, /sincroniz/i);
  assert.doesNotMatch(`${refill.title} ${refill.body}`, /registrad|confirmad/i);

  // Consignación: bloqueo con razón (trazabilidad de inventario).
  const consign = m.consignmentOfflineBlockMessage();
  assert.match(consign.title, /sin conexión/i);
  assert.match(consign.body, /trazab/i);
  assert.match(consign.body, /conexión/i);

  // Preventa: bloqueo, explica que la cotización se genera en Odoo.
  const presale = m.presaleOfflineBlockMessage();
  assert.match(presale.title, /sin conexión/i);
  assert.match(presale.body, /cotización/i);
  assert.doesNotMatch(presale.body, /registrad[ao]\b(?!.*Odoo)/i);

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
