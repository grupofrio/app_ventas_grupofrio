/**
 * Venta offline: aviso + etiqueta del botón para "pedido pendiente de envío".
 */
import assert from 'node:assert/strict';

interface Mod {
  describeSaleOfflineUx: (isOnline: boolean) => {
    showBanner: boolean; bannerText: string; buttonHint: string | null;
  };
  saleConfirmButtonLabel: (input: {
    saleSyncStatus: 'none' | 'pending' | 'done' | 'failed';
    isOnline: boolean; saleConfirmed: boolean;
  }) => string;
}

function run(m: Mod) {
  // ── Banner / hint ────────────────────────────────────────────────────────
  const on = m.describeSaleOfflineUx(true);
  assert.equal(on.showBanner, false);
  assert.equal(on.buttonHint, null);

  const off = m.describeSaleOfflineUx(false);
  assert.equal(off.showBanner, true);
  assert.match(off.bannerText, /sin conexión/i);
  assert.match(off.bannerText, /pendiente/i);            // modelo pedido pendiente
  assert.match(off.bannerText, /no queda confirmado/i);  // honesto: no confirma offline
  assert.ok(off.buttonHint && /reconect|conexión/i.test(off.buttonHint));

  // ── Etiqueta del botón ───────────────────────────────────────────────────
  const base = { isOnline: true, saleConfirmed: false } as const;
  // El estado de sync manda sobre el lock local.
  assert.match(m.saleConfirmButtonLabel({ ...base, saleSyncStatus: 'pending' }), /pendiente de env/i);
  assert.match(m.saleConfirmButtonLabel({ ...base, saleSyncStatus: 'failed' }), /error/i);
  assert.match(m.saleConfirmButtonLabel({ ...base, saleSyncStatus: 'done' }), /enviado/i);
  // Pedido pendiente NUNCA se rotula "confirmado" aunque haya lock local.
  assert.match(
    m.saleConfirmButtonLabel({ saleSyncStatus: 'pending', isOnline: false, saleConfirmed: true }),
    /pendiente de env/i,
  );
  // Sin item en cola: online directo.
  assert.equal(m.saleConfirmButtonLabel({ saleSyncStatus: 'none', isOnline: true, saleConfirmed: false }), '✓ Confirmar Pedido');
  assert.match(m.saleConfirmButtonLabel({ saleSyncStatus: 'none', isOnline: false, saleConfirmed: false }), /guardar pedido pendiente/i);
  assert.match(m.saleConfirmButtonLabel({ saleSyncStatus: 'none', isOnline: true, saleConfirmed: true }), /confirmado/i);

  console.log('sale offline UX tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/saleOfflineUx.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
