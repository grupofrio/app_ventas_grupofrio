import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const picker = readFileSync(resolve(root, 'src/components/domain/ProductPicker.tsx'), 'utf8');
const sale = readFileSync(resolve(root, 'app/sale/[stopId].tsx'), 'utf8');
const consignment = readFileSync(resolve(root, 'app/consignment/[stopId].tsx'), 'utf8');
const presale = readFileSync(resolve(root, 'app/presale.tsx'), 'utf8');

assert.match(picker, /allowPendingPrice\?: boolean/, 'el selector debe requerir opt-in explícito');
assert.match(sale, /<ProductPicker[\s\S]*?allowPendingPrice/, 'sólo Venta directa debe habilitar precio pendiente');
assert.doesNotMatch(consignment, /allowPendingPrice/, 'Consignación conserva precio autorizado');
assert.doesNotMatch(presale, /allowPendingPrice/, 'Preventa conserva precio autorizado');
assert.match(picker, /canUsePendingPrice/, 'sin red y sin caché, Venta directa debe poder seleccionar pendiente');
assert.match(picker, /Pendiente de confirmar/, 'la lista no debe presentar cero como precio final');

console.log('product picker pending-price wiring tests: ok');
