import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const stopScreenPath = resolve(REPO_ROOT, 'app/stop/[stopId].tsx');
const customerEditScreenPath = resolve(REPO_ROOT, 'app/customer/[partnerId].tsx');
const syncStorePath = resolve(REPO_ROOT, 'src/stores/useSyncStore.ts');

function main() {
  const stopScreen = readFileSync(stopScreenPath, 'utf8');

  assert.match(
    stopScreen,
    /Editar cliente/,
    'la pantalla de parada debe mostrar el boton Editar cliente junto al nombre del cliente',
  );
  assert.match(
    stopScreen,
    /router\.push\(\{[\s\S]*pathname: '\/customer\/\[partnerId\]'[\s\S]*partnerId:[\s\S]*stopId:/,
    'el boton debe navegar a /customer/[partnerId] pasando partnerId y stopId',
  );

  assert.equal(
    existsSync(customerEditScreenPath),
    true,
    'debe existir una pantalla dedicada para editar el cliente',
  );

  const customerEditScreen = readFileSync(customerEditScreenPath, 'utf8');
  assert.match(
    customerEditScreen,
    /enqueue\('customer_update'/,
    'la pantalla debe encolar customer_update para sincronizar res.partner',
  );
  assert.match(
    customerEditScreen,
    /buildCustomerContactUpdatePayload/,
    'la pantalla debe usar el helper de payload de contacto',
  );
  assert.match(
    customerEditScreen,
    /patchStop\(currentStop\.id/,
    'la pantalla debe parchear la parada local para reflejar cambios inmediatos',
  );

  const syncStore = readFileSync(syncStorePath, 'utf8');
  const customerUpdateBlock = syncStore.match(/case 'customer_update':[\s\S]*?break;/)?.[0] ?? '';
  assert.match(
    customerUpdateBlock,
    /syncCustomerContactUpdate\(/,
    'customer_update debe usar el writer ORM autenticado para evitar el bloqueo de res.partner en /api/create_update',
  );
  assert.doesNotMatch(
    customerUpdateBlock,
    /\/api\/create_update/,
    'customer_update no debe llamar el endpoint generico que rechaza res.partner',
  );

  console.log('customer edit frontend wiring tests: ok');
}

main();
