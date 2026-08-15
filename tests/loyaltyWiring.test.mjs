import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * Wiring de Lealtad: el botón del cliente ya no es placeholder muerto y navega
 * a la pantalla real; la pantalla ya no es un stub.
 */
const root = process.cwd();
const stop = fs.readFileSync(path.join(root, 'app/stop/[stopId].tsx'), 'utf8');
const screen = fs.readFileSync(path.join(root, 'app/loyalty/[partnerId].tsx'), 'utf8');
const loyaltyService = fs.readFileSync(path.join(root, 'src/services/loyalty.ts'), 'utf8');

// 1. Stop: el placeholder muerto (Alert 'F8...') desapareció.
assert(!stop.includes("F8: Programa de lealtad"), 'placeholder muerto de Lealtad debe eliminarse');
// 2. Stop: el botón Lealtad navega a la pantalla real.
assert(stop.includes("'/loyalty/[partnerId]'") || stop.includes('/loyalty/'), 'botón Lealtad debe navegar a /loyalty');

// 3. Pantalla: ya no es stub — usa el servicio real.
assert(screen.includes('fetchPartnerLoyalty'), 'la pantalla debe cargar datos reales');
assert(screen.includes('hasLoyaltyData'), 'la pantalla debe manejar empty state');
// 4. El bug del stub (partnerId={}) ya no existe.
assert(!screen.includes('partnerId={}'), 'el stub roto partnerId={} debe eliminarse');

assert.match(loyaltyService, /import\s*\{\s*postRest\s*\}\s*from ['"]\.\/api['"]/);
assert.match(loyaltyService, /\$\{EMPLOYEE_API_BASE\}\/customer\/loyalty/);
assert.match(loyaltyService, /\{\s*partner_id:\s*partnerId\s*\}/);
assert.doesNotMatch(
  loyaltyService,
  /odooRpc|odooRead|odooSession|call_kw|execute_kw|get_records|\/api\/create_update/,
  'lealtad debe usar solo REST Bearer acotado',
);
assert.doesNotMatch(
  loyaltyService,
  /employee_id|company_id/,
  'la autoridad de lealtad se deriva exclusivamente del Bearer',
);

console.log('loyalty wiring tests: ok');
