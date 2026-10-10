import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeOpenStopsConfirmation,
  formatCloseStopLine,
  partitionOpenStops,
  planIsClosedState,
  routeCloseShowsFinished,
  validateArrivalKm,
} from '../src/services/routeClosePreconditions.ts';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
}

function main() {
  const open = partitionOpenStops([
    { id: 3, customer_name: 'En curso B', route_sequence: 8, state: 'in_progress' },
    { id: 1, customer_name: 'Hecha', route_sequence: 1, state: 'done' },
    { id: 2, customer_name: 'Pendiente A', route_sequence: 4, state: 'pending' },
    { id: 4, customer_name: 'En curso A', route_sequence: 2, state: 'in_progress' },
    { id: 5, customer_name: 'Pendiente B', route_sequence: 9, state: 'pending' },
    { id: 6, customer_name: 'No visitada', state: 'not_visited' },
  ]);
  assert.deepEqual(open.pending.map((stop) => stop.id), [2, 5]);
  assert.deepEqual(open.inProgress.map((stop) => stop.id), [4, 3]);
  assert.equal(formatCloseStopLine(open.inProgress[0]), '2 · En curso A');

  const warning = describeOpenStopsConfirmation(open);
  assert.equal(warning.requiresCheckout, true);
  assert.equal(warning.requiresAcknowledgement, true);
  assert.match(warning.title, /2 visita\(s\) en curso/);
  assert.match(warning.title, /2 pendiente/);
  assert.match(warning.message, /2 · En curso A/);
  assert.match(warning.message, /8 · En curso B/);
  assert.match(warning.message, /4 · Pendiente A/);
  assert.match(warning.message, /9 · Pendiente B/);
  assert.doesNotMatch(warning.message, /Hecha/);

  const pendingOnly = describeOpenStopsConfirmation({
    pending: [{ id: 9, customer_name: 'Sin ir', route_sequence: 1, state: 'pending' }],
    inProgress: [],
  });
  assert.equal(pendingOnly.requiresCheckout, false);
  assert.equal(pendingOnly.requiresAcknowledgement, true);
  assert.match(pendingOnly.message, /1 · Sin ir/);

  const clear = describeOpenStopsConfirmation({ pending: [], inProgress: [] });
  assert.equal(clear.requiresAcknowledgement, false);
  assert.equal(clear.requiresCheckout, false);

  const fieldCase = validateArrivalKm({ arrival: 0, departure: 12409 });
  assert.equal(fieldCase.ok, false);
  const below = validateArrivalKm({ arrival: '12000', departure: 12409 });
  assert.equal(below.ok, false);
  if (!below.ok) assert.match(below.message, /12,409|12409/);
  const okKm = validateArrivalKm({ arrival: '12,450', departure: 12409 });
  assert.deepEqual(okKm, { ok: true, arrival: 12450 });
  const noDeparture = validateArrivalKm({ arrival: 100, departure: null });
  assert.deepEqual(noDeparture, { ok: true, arrival: 100 });

  assert.equal(planIsClosedState('closed'), true);
  assert.equal(planIsClosedState('in_progress'), false);

  // F39: plan 7281 was closed with arrival_km 0. The finished copy must not hide KM.
  assert.equal(routeCloseShowsFinished({
    planState: 'closed',
    arrivalKm: 0,
    departureKm: 12409,
  }), false);
  assert.equal(routeCloseShowsFinished({
    planState: 'closed',
    arrivalKm: 12450,
    departureKm: 12409,
  }), true);
  assert.equal(routeCloseShowsFinished({
    planState: 'in_progress',
    localClosed: true,
    arrivalKm: 12450,
    departureKm: 12409,
  }), true);
  assert.equal(routeCloseShowsFinished({
    planState: 'in_progress',
    arrivalKm: 12450,
    departureKm: 12409,
  }), false);

  const cashclose = read('app/cashclose.tsx');
  const routeClose = read('app/route-close.tsx');
  const liquidation = read('src/services/gfLogistics.ts');
  const checkout = read('src/services/closeInProgressStops.ts');

  assert.match(cashclose, /KM llegada/);
  assert.match(cashclose, /validateArrivalKm/);
  assert.match(cashclose, /describeOpenStopsConfirmation/);
  assert.match(cashclose, /checkoutInProgressStops/);
  assert.match(cashclose, /updateKm\(planId, 'arrival'/);
  const checkoutAt = cashclose.indexOf('checkoutInProgressStops(');
  const kmAt = cashclose.indexOf("updateKm(planId, 'arrival'");
  const confirmAt = cashclose.indexOf('confirmRouteLiquidation({');
  assert.ok(checkoutAt > 0 && kmAt > checkoutAt && confirmAt > kmAt, 'checkout and KM llegada run before liquidacion/confirm');

  assert.match(routeClose, /routeCloseShowsFinished/);
  assert.match(routeClose, /describeOpenStopsConfirmation/);
  assert.match(routeClose, /checkoutInProgressStops/);
  assert.match(routeClose, /sin KM de llegada/);
  assert.match(routeClose, /Tu operación del día quedó finalizada/);

  assert.match(liquidation, /body\.arrival_km = payload\.arrival_km/);
  assert.match(liquidation, /body\.acknowledge_open_stops = true/);
  assert.match(checkout, /stuckVisitSaleTotal/);

  console.log('route close preconditions: ok');
}

main();
