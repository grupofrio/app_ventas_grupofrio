import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WAREHOUSE_HANDOFF_ACTION,
  SUPERVISOR_WAIT_ACTION,
  formatRouteReturnClock,
  formatSellerReturnStatus,
  parseLeftoverReceipt,
  routeReturnCloseGuidance,
  routeReturnClosePresentation,
  sellerCanEditReturn,
  type RouteLeftoverReceipt,
} from '../src/services/routeReturnStatus.ts';
import {
  hasSavedArrivalKm,
  isArrivalKmGreaterThanDeparture,
} from '../src/services/routeStartLogic.ts';

function receipt(patch: Partial<RouteLeftoverReceipt> = {}): RouteLeftoverReceipt {
  return {
    plan_id: 1209,
    plan_name: 'RPLAN/2026/01209',
    blind_receipt_enabled: true,
    status: 'pending_reception',
    status_label: 'Pendiente de recepción en Almacén',
    received_by_id: null,
    received_by: null,
    received_at: null,
    resolved_by_id: null,
    resolved_by: null,
    resolved_at: null,
    resolution: null,
    can_edit: false,
    ...patch,
  };
}

test('parseLeftoverReceipt keeps the seller payload and drops quantities', () => {
  const parsed = parseLeftoverReceipt({
    plan_id: 12,
    plan_name: 'RPLAN/1',
    blind_receipt_enabled: true,
    status: 'received',
    status_label: 'Recibido en Almacén',
    received_by_id: 7,
    received_by: 'Marisol',
    received_at: '2026-10-08T21:30:00Z',
    can_edit: false,
    lines: [{ declared_qty: 4, counted_qty: 4 }],
  });
  assert.equal(parsed?.status, 'received');
  assert.equal(parsed?.received_by, 'Marisol');
  assert.equal(parsed?.blind_receipt_enabled, true);
  assert.equal('lines' in (parsed ?? {}), false);
  assert.equal(sellerCanEditReturn(parsed), false);
  assert.equal(parseLeftoverReceipt({ ok: true }), null);
  assert.equal(parseLeftoverReceipt(null), null);
});

test('seller status stays hidden when the switch is off or there is no receipt yet', () => {
  assert.equal(formatSellerReturnStatus(null), null);
  assert.equal(formatSellerReturnStatus(receipt({
    blind_receipt_enabled: false,
    status: null,
    status_label: null,
  })), null);
  assert.equal(formatSellerReturnStatus(receipt({ status: null, status_label: null })), null);
  assert.equal(
    formatSellerReturnStatus(receipt()),
    'Pendiente de recepción en Almacén',
  );
});

test('received status names who counted and when', () => {
  const label = formatSellerReturnStatus(receipt({
    status: 'received',
    status_label: 'Recibido en Almacén',
    received_by: 'Marisol',
    received_at: '2026-10-08T21:30:00Z',
  }));
  assert.match(label ?? '', /^Recibido en Almacén por Marisol /);
  assert.match(label ?? '', /15:30/);
  assert.match(formatRouteReturnClock('8 oct 2026, 15:30') ?? '', /15:30/);
  assert.equal(
    formatSellerReturnStatus(receipt({
      status: 'received_with_difference',
      status_label: 'Recibido con diferencia, pendiente del supervisor',
    })),
    'Recibido con diferencia, pendiente del supervisor',
  );
  assert.equal(
    formatSellerReturnStatus(receipt({
      status: 'resolved',
      status_label: 'Diferencia resuelta',
    })),
    'Diferencia resuelta',
  );
});

test('route close warnings about the return are actionable and not generic errors', () => {
  const pending = routeReturnCloseGuidance(
    'No se puede cerrar la ruta: la devolución de la unidad está pendiente de recepción en Almacén.',
  );
  assert.equal(pending?.action, WAREHOUSE_HANDOFF_ACTION);

  const unit = routeReturnCloseGuidance(
    'No se puede cerrar la ruta: la unidad todavía tiene producto. La devolución sigue pendiente de recepción en Almacén.',
  );
  assert.equal(unit?.action, WAREHOUSE_HANDOFF_ACTION);

  const supervisor = routeReturnCloseGuidance(
    'No se puede cerrar la ruta: la diferencia de la devolución está pendiente de resolución del supervisor.',
  );
  assert.equal(supervisor?.action, SUPERVISOR_WAIT_ACTION);

  assert.equal(routeReturnCloseGuidance('Hay 5 paradas pendientes al cierre.'), null);
  assert.equal(routeReturnCloseGuidance(null), null);
});

test('status alone explains the close block until route_close_warning arrives', () => {
  const fromStatus = routeReturnClosePresentation({
    receipt: receipt({ status: 'pending_reception' }),
  });
  assert.equal(fromStatus?.action, WAREHOUSE_HANDOFF_ACTION);
  assert.equal(routeReturnClosePresentation({
    receipt: receipt({ blind_receipt_enabled: false, status: null }),
  }), null);
  assert.equal(routeReturnClosePresentation({
    receipt: receipt({ status: 'resolved', status_label: 'Diferencia resuelta' }),
  }), null);
});

test('arrival KM must be strictly greater than the starting KM', () => {
  assert.equal(isArrivalKmGreaterThanDeparture(12386, 12385), true);
  assert.equal(isArrivalKmGreaterThanDeparture(12385, 12385), false);
  assert.equal(isArrivalKmGreaterThanDeparture(12384, 12385), false);
  assert.equal(hasSavedArrivalKm(12386, 12385), true);
  assert.equal(hasSavedArrivalKm(12385, 12385), false);
  assert.equal(hasSavedArrivalKm(null, 12385), false);
  assert.equal(hasSavedArrivalKm(10, null), true);
});
