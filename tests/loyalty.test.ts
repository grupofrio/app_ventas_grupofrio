/**
 * Lealtad: parseo de res.partner, presentación de nivel, empty state.
 */
import assert from 'node:assert/strict';

interface Mod {
  parsePartnerLoyalty: (raw: unknown) => any;
  hasLoyaltyData: (l: any) => boolean;
  describeLoyaltyLevel: (level: string | null) => { label: string; emoji: string; next: string | null };
}

function run(m: Mod) {
  // Parseo de un registro completo.
  const full = m.parsePartnerLoyalty({
    id: 100, name: 'Abarrotes Lupita',
    x_loyalty_level: 'plata', x_loyalty_streak: 6, x_last_order_week: 24,
  });
  assert.deepEqual(full, {
    partnerId: 100, name: 'Abarrotes Lupita', level: 'plata', streakWeeks: 6, lastOrderWeek: 24,
  });
  assert.equal(m.hasLoyaltyData(full), true);

  // Campos vacíos de Odoo (false / ausentes) → defaults seguros, level null.
  const empty = m.parsePartnerLoyalty({ id: 5, name: 'X', x_loyalty_level: false });
  assert.equal(empty.level, null);
  assert.equal(empty.streakWeeks, 0);
  assert.equal(empty.lastOrderWeek, null);
  assert.equal(m.hasLoyaltyData(empty), false, 'sin nivel ni streak → empty state');

  // streak>0 sin nivel → sí hay dato.
  assert.equal(m.hasLoyaltyData(m.parsePartnerLoyalty({ id: 5, name: 'X', x_loyalty_streak: 2 })), true);

  // Nivel inválido → null (no rompe).
  assert.equal(m.parsePartnerLoyalty({ id: 5, name: 'X', x_loyalty_level: 'diamante' }).level, null);

  // Inválidos → null sin crash.
  for (const bad of [null, undefined, 42, 'x', {}, { id: 0 }, { id: -1 }]) {
    assert.equal(m.parsePartnerLoyalty(bad), null, `inválido ${JSON.stringify(bad)} → null`);
  }
  assert.equal(m.hasLoyaltyData(null), false);

  // Presentación de nivel.
  assert.deepEqual(m.describeLoyaltyLevel('oro'), { label: 'Oro', emoji: '🥇', next: null });
  assert.equal(m.describeLoyaltyLevel('plata').next, 'Oro');
  assert.equal(m.describeLoyaltyLevel('bronce').next, 'Plata');
  assert.equal(m.describeLoyaltyLevel(null).label, 'Sin nivel');
  assert.equal(m.describeLoyaltyLevel(null).next, 'Bronce');

  console.log('loyalty tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/loyaltyLogic.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
