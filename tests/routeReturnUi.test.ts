import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read = (path: string) => readFileSync(resolve(path), 'utf8');

test('seller return status uses the employee logistics endpoint and embedded leftover_receipt', () => {
  const logistics = read('src/services/gfLogistics.ts');
  assert.match(logistics, /export async function fetchRouteReturnStatus\(/);
  assert.match(logistics, /\$\{GF_BASE\}\/route-return\/status/);
  assert.match(logistics, /plan_id: planId/);
  assert.match(logistics, /leftover_receipt: parseLeftoverReceipt\(rawData\?\.leftover_receipt\)/);
  assert.match(logistics, /leftover_receipt: parseLeftoverReceipt\(rawData\.leftover_receipt\)/);
});

test('Cerrar ruta and Corte de Caja show status, refresh, and the warehouse handoff', () => {
  const routeClose = read('app/route-close.tsx');
  const cashclose = read('app/cashclose.tsx');
  const card = read('src/components/RouteReturnStatusCard.tsx');

  for (const source of [routeClose, cashclose]) {
    assert.match(source, /fetchRouteReturnStatus/);
    assert.match(source, /RouteReturnStatusCard/);
    assert.match(source, /RouteReturnCloseBanner/);
    assert.match(source, /RefreshControl/);
  }
  assert.match(card, /Actualizar estado/);
  assert.match(card, /Entrega el producto a Almacén y espera a que lo reciba|routeReturnClosePresentation/);
  assert.match(routeClose, /KM final igual al inicial/);
  assert.match(routeClose, /isArrivalKmGreaterThanDeparture/);
  assert.match(routeClose, /Cierre pendiente/);
  assert.match(cashclose, /hasSavedArrivalKm/);
  assert.match(cashclose, /El efectivo quedo confirmado en Odoo/);
  assert.doesNotMatch(cashclose, /Alert\.alert\(\s*'Liquidacion confirmada',\s*result\.message/);
});

test('manual return inputs stay for the switch-off path and hide when blind receipt is on', () => {
  const cashclose = read('app/cashclose.tsx');
  assert.match(cashclose, /Regresa a stock/);
  assert.match(cashclose, /Guardar devolución \/ merma/);
  assert.match(cashclose, /handleSaveCorteAdjustments/);
  assert.match(cashclose, /!blindReceiptOn/);
  assert.match(cashclose, /blind_receipt_enabled/);
  assert.match(
    cashclose,
    /Almacén cuenta el sobrante con un conteo ciego/,
  );
});
