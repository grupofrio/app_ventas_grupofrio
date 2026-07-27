import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

const checkinScreen = readFileSync(
  resolve(REPO_ROOT, 'app/checkin/[stopId].tsx'),
  'utf8',
);
const exchangeScreen = readFileSync(
  resolve(REPO_ROOT, 'app/exchange/[stopId].tsx'),
  'utf8',
);
const gfLogistics = readFileSync(
  resolve(REPO_ROOT, 'src/services/gfLogistics.ts'),
  'utf8',
);

function main() {
  assert.match(
    checkinScreen,
    /router\.push\(`\/exchange\/\$\{stop\.id\}` as never\)/,
    'la visita activa debe navegar a la pantalla de cambio de producto',
  );

  assert.match(
    checkinScreen,
    /Registrar Cambio/,
    'la visita activa debe mostrar el CTA Registrar Cambio',
  );

  assert.match(
    exchangeScreen,
    /Producto Nuevo \(Entrega\)/,
    'la pantalla de cambio debe renderizar la sección de entrega',
  );

  assert.match(
    exchangeScreen,
    /Producto Dañado \(Merma\)/,
    'la pantalla de cambio debe renderizar la sección de merma',
  );

  assert.match(
    exchangeScreen,
    /let registeredMessage = 'Cambio procesado';/,
    'el submit debe conservar un mensaje registrado estable para el post-exito',
  );

  assert.match(
    exchangeScreen,
    /await saveExchangeTicketSnapshot\(snapshot\);/,
    'el submit debe guardar un snapshot local estricto del ticket tras el backend',
  );

  assert.match(
    exchangeScreen,
    /pathname:\s*'\/print-exchange\/\[snapshotId\]'/,
    'el submit exitoso debe navegar al ticket local de cambio',
  );

  assert.match(
    exchangeScreen,
    /Cambio registrado, pero no se pudo preparar el ticket\./,
    'si guardar el snapshot falla, la UI debe dejar claro que no debe repetirse el cambio',
  );

  assert.match(
    exchangeScreen,
    /exchangeMessage:\s*registeredMessage/,
    'ante fallo de guardado debe volver a check-in con el mensaje ya registrado',
  );

  assert.match(
    gfLogistics,
    /exchange\/create/,
    'gfLogistics debe exponer el endpoint de cambio de producto',
  );

  console.log('exchange frontend wiring tests: ok');
}

main();
