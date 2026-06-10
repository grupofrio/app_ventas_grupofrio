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

  // Aviso de teléfono faltante (captura en visita)
  assert.match(
    stopScreen,
    /hasContactPhone\(stop\)/,
    'la pantalla de parada debe detectar cliente sin telefono con hasContactPhone (phone/mobile, sin x_wa_phone)',
  );
  assert.match(
    stopScreen,
    /MISSING_PHONE_NOTICE/,
    'la pantalla de parada debe mostrar el aviso de telefono faltante',
  );
  assert.match(
    stopScreen,
    /MISSING_PHONE_CTA_LABEL/,
    'el aviso debe incluir el CTA Capturar telefono',
  );
  assert.match(
    stopScreen,
    /showMissingPhoneNotice[\s\S]*AlertBanner[\s\S]*MISSING_PHONE_NOTICE[\s\S]*onPress=\{openCustomerEditor\}/,
    'el CTA del aviso debe abrir el editor de cliente existente',
  );
  assert.doesNotMatch(
    stopScreen,
    /x_wa_phone/,
    'la pantalla de parada no debe usar x_wa_phone',
  );

  assert.match(
    customerEditScreen,
    /phoneChanged\(initialContact\.(phone|mobile)/,
    'la edicion debe detectar reemplazo de telefono existente',
  );
  assert.match(
    customerEditScreen,
    /Confirmar cambio[\s\S]*Reemplazar/,
    'reemplazar un telefono existente debe pedir confirmacion explicita',
  );

  const contactServicePath = resolve(REPO_ROOT, 'src/services/customerContactUpdate.ts');
  const contactService = readFileSync(contactServicePath, 'utf8');
  assert.doesNotMatch(
    contactService,
    /x_wa_phone/,
    'el servicio de contacto no debe leer ni escribir x_wa_phone (dominio del bot)',
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
