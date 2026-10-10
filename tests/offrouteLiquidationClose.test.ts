import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import {
  describeOpenStopsConfirmation,
  formatCloseStopLine,
  isOffrouteOpenStop,
  offrouteVisitIdForClose,
  partitionOpenStops,
} from '../src/services/routeClosePreconditions.ts';

const root = resolve();

const prospect = {
  id: -48211,
  customer_name: 'Prospecto Norte',
  route_sequence: 999,
  state: 'in_progress' as const,
  source_model: 'gf.offroute.visit',
  _isOffroute: true,
  _offrouteVisitId: 2061,
};

test('an in-progress off-route visit is listed and closed as no_sale on the server', () => {
  assert.equal(isOffrouteOpenStop(prospect), true);
  assert.equal(isOffrouteOpenStop({ id: 221168, state: 'in_progress' }), false);
  assert.equal(offrouteVisitIdForClose(prospect), 2061);
  assert.equal(offrouteVisitIdForClose({ ...prospect, _offrouteVisitId: null }, 3100), 3100);
  assert.equal(formatCloseStopLine(prospect), 'Fuera de ruta · Prospecto Norte');

  const open = partitionOpenStops([
    prospect,
    { id: 4, customer_name: 'En curso A', route_sequence: 2, state: 'in_progress' },
    { id: 1, customer_name: 'Hecha', route_sequence: 1, state: 'done' },
  ]);
  assert.deepEqual(open.inProgress.map((stop) => stop.id), [4, prospect.id]);

  const warning = describeOpenStopsConfirmation(open);
  assert.equal(warning.requiresCheckout, true);
  assert.match(warning.message, /Fuera de ruta · Prospecto Norte/);
  assert.match(warning.message, /2 · En curso A/);
  assert.match(warning.message, /Las visitas fuera de ruta se cierran en el servidor como sin venta/);
  assert.doesNotMatch(warning.message, /999 · Prospecto Norte/);
});

test('CERRAR VISITAS Y LIQUIDAR posts the off-route close and stops when it fails', () => {
  const checkout = readFileSync(resolve(root, 'src/services/closeInProgressStops.ts'), 'utf8');
  const branchStart = checkout.indexOf('if (isOffrouteOpenStop(stop))');
  const branchEnd = checkout.indexOf('const currentStopId = useVisitStore.getState().currentStopId;');
  const offrouteBranch = checkout.slice(branchStart, branchEnd);

  assert.match(offrouteBranch, /closeOffrouteVisit\(\{/);
  assert.match(offrouteBranch, /result_status: 'no_sale'/);
  assert.match(offrouteBranch, /No se cerró la visita fuera de ruta en el servidor/);
  const closeAt = offrouteBranch.indexOf('closeOffrouteVisit(');
  const failAt = offrouteBranch.indexOf('ok: false');
  const removeAt = offrouteBranch.indexOf('removeStop(stop.id)');
  assert.ok(closeAt > 0 && failAt > closeAt && removeAt > failAt, 'a failed server close must not delete the visit locally');
  assert.match(checkout, /readHasSyncedSale/);
  assert.match(checkout, /retryCheckoutAsNoSale/);
});
