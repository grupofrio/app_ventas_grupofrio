/**
 * Venta offline UX: avisar sin habilitar venta offline (evidencia de campo).
 */
import assert from 'node:assert/strict';

interface Mod {
  describeSaleOfflineUx: (isOnline: boolean) => {
    showBanner: boolean; bannerText: string; buttonHint: string | null;
  };
}

function run(m: Mod) {
  // Online → sin banner ni hint (no estorba).
  const on = m.describeSaleOfflineUx(true);
  assert.equal(on.showBanner, false);
  assert.equal(on.buttonHint, null);

  // Offline → banner + hint claros, sin prometer venta offline.
  const off = m.describeSaleOfflineUx(false);
  assert.equal(off.showBanner, true);
  assert.ok(off.bannerText.length > 0);
  assert.match(off.bannerText, /sin conexión/i);
  assert.match(off.bannerText, /capturar/i);     // no pierde captura
  assert.match(off.bannerText, /confirmar/i);     // aclara qué requiere red
  assert.ok(off.buttonHint && /conecta/i.test(off.buttonHint), 'hint guía a conectarse');
  // No debe sugerir que la venta se guarda/confirma offline.
  assert.doesNotMatch(off.bannerText, /guardad|offline|sin internet vend/i);

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
