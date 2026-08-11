import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const productStore = readFileSync(
    resolve(REPO_ROOT, 'src/stores/useProductStore.ts'),
    'utf8',
  );

  assert.match(
    productStore,
    /if \(!scoped \|\| scoped\.products\.length === 0\) \{/,
    'sin catalogo de truck_stock debe entrar al camino de degradacion explicita',
  );
  assert.match(
    productStore,
    /loaded_truck_stock_reference/,
    'debe quedar log claro cuando truck_stock responde catalogo sin stock real',
  );
  assert.match(
    productStore,
    /Sin catálogo de existencias para tu unidad/,
    'sin datos de truck_stock el estado debe ser un error honesto, no un catalogo global',
  );

  // Security migration (2026-08): truck_stock es la UNICA fuente de
  // catalogo/stock. No debe quedar ningun rastro del cliente ORM/RPC
  // privilegiado (odooRpc, odooSession) ni de los fallbacks stock.quant /
  // product.product leidos directo desde el movil.
  assert.doesNotMatch(
    productStore,
    /from ['"]\.\.\/services\/odooRpc['"]/,
    'useProductStore no debe importar el cliente Odoo privilegiado',
  );
  assert.doesNotMatch(
    productStore,
    /odooRead\(['"]stock\.quant['"]/,
    'no debe quedar una lectura directa de stock.quant via ORM/API-key generico',
  );
  assert.doesNotMatch(
    productStore,
    /odooRead\(['"]product\.product['"]/,
    'no debe quedar una lectura directa de product.product via ORM/API-key generico',
  );

  console.log('truck stock fallback wiring tests: ok');
}

main();
