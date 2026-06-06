import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath handles Windows correctly (new URL('.').pathname leaves a
// leading slash + drive like /C:/... → resolve produced C:\C:\...).
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
}

function main() {
  const sales = read('app/(tabs)/sales.tsx');
  const cashclose = read('app/cashclose.tsx');
  const gfLogistics = read('src/services/gfLogistics.ts');

  assert.match(
    sales,
    /label="💰 Corte y Liquidacion"/,
    'Ventas debe mostrar un boton visible de Corte y Liquidacion',
  );
  assert.doesNotMatch(
    sales,
    /router\.push\('\/ranking'/,
    'El boton visible en Ventas ya no debe llevar a Ranking',
  );

  assert.match(gfLogistics, /export async function fetchRouteReconciliation\(/);
  assert.match(gfLogistics, /\$\{GF_BASE\}\/reconciliation/);
  assert.match(gfLogistics, /export async function validateRouteCorte\(/);
  assert.match(gfLogistics, /pwa-ruta\/validate-corte/);
  assert.match(gfLogistics, /export async function confirmRouteLiquidation\(/);
  assert.match(gfLogistics, /\$\{GF_BASE\}\/liquidacion\/confirm/);
  assert.match(gfLogistics, /export async function saveRouteCorteAdjustments\(/);
  assert.match(gfLogistics, /\$\{GF_BASE\}\/corte\/adjustments/);

  assert.match(cashclose, /handleValidateCorte/);
  assert.match(cashclose, /handleSaveCorteAdjustments/);
  assert.match(cashclose, /handleConfirmLiquidation/);
  assert.match(cashclose, /Regresa a stock/);
  assert.match(cashclose, /Merma/);
  assert.match(cashclose, /Guardar devolución \/ merma/);
  assert.match(cashclose, /Confirmar corte/);
  assert.match(cashclose, /Confirmar liquidacion/);
  assert.match(cashclose, /difference_warning/);

  console.log('cashclose settlement flow tests: ok');
}

main();
