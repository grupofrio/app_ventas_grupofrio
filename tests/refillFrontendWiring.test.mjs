import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

const refillScreen = readFileSync(
  resolve(REPO_ROOT, 'app/refill.tsx'),
  'utf8',
);

function main() {
  assert.match(
    refillScreen,
    /function setRefillQty\(productId: number, productName: string, qtyText: string\)/,
    'la pantalla de carga debe permitir capturar directamente la cantidad solicitada',
  );

  assert.match(
    refillScreen,
    /keyboardType="number-pad"/,
    'el campo de cantidad de carga debe abrir teclado numerico',
  );

  assert.match(
    refillScreen,
    /selectTextOnFocus/,
    'la cantidad debe seleccionarse al enfocar para reemplazarla rapido en campo',
  );

  console.log('refill frontend wiring tests: ok');
}

main();
