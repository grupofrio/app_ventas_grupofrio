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

// 1. Stop: el placeholder muerto (Alert 'F8...') desapareció.
assert(!stop.includes("F8: Programa de lealtad"), 'placeholder muerto de Lealtad debe eliminarse');
// 2. Stop: el botón Lealtad navega a la pantalla real.
assert(stop.includes("'/loyalty/[partnerId]'") || stop.includes('/loyalty/'), 'botón Lealtad debe navegar a /loyalty');

// 3. Pantalla: ya no es stub — usa el servicio real.
assert(screen.includes('fetchPartnerLoyalty'), 'la pantalla debe cargar datos reales');
assert(screen.includes('hasLoyaltyData'), 'la pantalla debe manejar empty state');
// 4. El bug del stub (partnerId={}) ya no existe.
assert(!screen.includes('partnerId={}'), 'el stub roto partnerId={} debe eliminarse');

console.log('loyalty wiring tests: ok');
