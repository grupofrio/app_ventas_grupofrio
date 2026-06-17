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
  isRefillSyncItem: (item: { type?: string; payload?: any }) => boolean;
  syncItemLabel: (item: { type?: string; payload?: any }, fallback: string) => string;
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

  // Etiqueta de Sync: refill (prospection con van.refill.request) → "Solicitud de carga".
  assert.equal(m.isRefillSyncItem({ type: 'prospection', payload: { model: 'van.refill.request' } }), true);
  assert.equal(m.isRefillSyncItem({ type: 'prospection', payload: { type: 'refill' } }), true);
  // Otros prospection (nuevo cliente / descarga) NO se confunden con refill.
  assert.equal(m.isRefillSyncItem({ type: 'prospection', payload: { model: 'crm.lead' } }), false);
  assert.equal(m.isRefillSyncItem({ type: 'no_sale', payload: {} }), false);
  assert.equal(m.syncItemLabel({ type: 'prospection', payload: { model: 'van.refill.request' } }, 'Operacion'), 'Solicitud de carga');
  assert.equal(m.syncItemLabel({ type: 'prospection', payload: { model: 'crm.lead' } }, 'Operacion'), 'Operacion');
  assert.equal(m.syncItemLabel({ type: 'checkin', payload: {} }, 'Check-in'), 'Check-in');

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
