import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

function main() {
  const pricelist = readFileSync(resolve(REPO_ROOT, 'src/services/pricelist.ts'), 'utf8');
  const picker = readFileSync(resolve(REPO_ROOT, 'src/components/domain/ProductPicker.tsx'), 'utf8');

  assert.doesNotMatch(
    pricelist,
    /\bodoo(?:Read|Rpc)\b|\/get_records|call_kw|execute_kw/,
    'Los precios de cliente no deben conservar lectores ORM/RPC ni fallbacks legacy',
  );
  assert.doesNotMatch(
    pricelist,
    /res\.partner|product\.pricelist(?:\.item)?/,
    'Los precios de cliente deben delegar la lista y las reglas al endpoint employee',
  );
  assert.match(
    pricelist,
    /throw new PricingUnavailableError/,
    'La ausencia de pricing\/by_partner debe ser un error explícito, nunca un cálculo local silencioso',
  );
  assert.match(
    picker,
    /const \[priceError, setPriceError\]/,
    'ProductPicker debe conservar el fallo de precios autorizado en estado explícito',
  );
  assert.match(
    picker,
    /Alert\.alert\('Precios no disponibles'/,
    'ProductPicker debe bloquear la selección cuando no hay precios autorizados',
  );
  assert.match(
    picker,
    /const \[hasAuthorizedPrices, setHasAuthorizedPrices\]/,
    'ProductPicker debe distinguir una respuesta autorizada de un mapa de precios vacío',
  );
  assert.match(
    picker,
    /priceLoading \|\| !hasAuthorizedPrices \|\| priceError/,
    'ProductPicker debe bloquear mientras carga o no existe una respuesta autorizada',
  );

  console.log('pricelist REST-only tests: ok');
}

main();
