import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface RouteLoadAcceptanceModule {
  buildRouteLoadAcceptanceState: (plan: any) => {
    loadCards: any[];
    pendingLoads: any[];
    acceptedLoads: any[];
    hasPendingLoad: boolean;
    nextPendingLoad: any | null;
  };
  buildInitialLoadAcceptanceState: (plan: any) => {
    initialLoads: any[];
    pendingInitialLoads: any[];
    rejectedInitialLoads: any[];
    initialLoadAccepted: boolean;
    initialLoadRejectedWaiting: boolean;
    nextPendingInitialLoad: any | null;
  };
  canStartSaleWithRouteLoad: (plan: any) => boolean;
  buildRouteLoadAcceptPayload: (routePlanId: number, pickingId: number) => Record<string, number>;
  buildRouteLoadRejectPayload: (input: {
    planId: number;
    pickingId: number;
    operationId: string;
    rejectionReasonCode: string;
    rejectionNotes?: string;
  }) => Record<string, string | number>;
}

function testBuildsInitialLoadAcceptanceState(m: RouteLoadAcceptanceModule) {
  assert.equal(
    typeof m.buildInitialLoadAcceptanceState,
    'function',
    'route load acceptance must expose initial-load-only readiness',
  );

  const pendingInitial = m.buildInitialLoadAcceptanceState({
    load_picking_id: 20,
    load_pickings: [
      { picking_id: 20, state: 'assigned', accepted: false, load_kind: 'initial' },
    ],
    pending_loads: [
      { picking_id: 20, state: 'assigned', accepted: false, load_kind: 'initial' },
    ],
  });
  assert.equal(pendingInitial.initialLoads.length, 1);
  assert.equal(pendingInitial.pendingInitialLoads.length, 1);
  assert.equal(pendingInitial.initialLoadAccepted, false);
  assert.equal(pendingInitial.nextPendingInitialLoad?.picking_id, 20);

  const withoutInitial = m.buildInitialLoadAcceptanceState({
    load_pickings: [
      { picking_id: 30, state: 'assigned', accepted: false, load_kind: 'refill' },
    ],
    pending_loads: [
      { picking_id: 30, state: 'assigned', accepted: false, load_kind: 'refill' },
    ],
  });
  assert.equal(withoutInitial.initialLoads.length, 0);
  assert.equal(withoutInitial.pendingInitialLoads.length, 0);
  assert.equal(
    withoutInitial.initialLoadAccepted,
    false,
    'missing initial load must not be interpreted as accepted',
  );
  assert.equal(withoutInitial.nextPendingInitialLoad, null);
  assert.equal(m.canStartSaleWithRouteLoad({ load_pickings: [], pending_loads: [] }), false);

  const withPendingRefill = m.buildInitialLoadAcceptanceState({
    load_picking_id: 80,
    load_pickings: [
      { picking_id: 80, load_kind: 'initial', accepted: true },
      { picking_id: 81, load_kind: 'refill', accepted: false, state: 'assigned' },
    ],
    pending_loads: [
      { picking_id: 81, load_kind: 'refill', accepted: false, state: 'assigned' },
    ],
  });
  assert.equal(withPendingRefill.initialLoads.length, 1);
  assert.equal(withPendingRefill.pendingInitialLoads.length, 0);
  assert.equal(withPendingRefill.initialLoadAccepted, true);
  assert.equal(withPendingRefill.initialLoadRejectedWaiting, false);
  assert.equal(withPendingRefill.nextPendingInitialLoad, null);
}

function testRejectedInitialDoesNotCountAsAccepted(m: RouteLoadAcceptanceModule) {
  const rejectedOnly = m.buildInitialLoadAcceptanceState({
    load_picking_id: 20,
    load_pickings: [
      { picking_id: 20, state: 'assigned', accepted: false, rejected: true, load_kind: 'initial' },
    ],
    pending_loads: [],
    rejected_loads: [
      { picking_id: 20, state: 'assigned', accepted: false, rejected: true, load_kind: 'initial' },
    ],
  });
  assert.equal(rejectedOnly.initialLoadAccepted, false, 'rejected-only wait is not accepted');
  assert.equal(rejectedOnly.initialLoadRejectedWaiting, true);
  assert.equal(rejectedOnly.pendingInitialLoads.length, 0);
  assert.equal(rejectedOnly.rejectedInitialLoads.length, 1);
  assert.equal(m.canStartSaleWithRouteLoad({
    load_picking_id: 20,
    load_pickings: [
      { picking_id: 20, state: 'assigned', accepted: false, rejected: true, load_kind: 'initial' },
    ],
    rejected_loads: [
      { picking_id: 20, rejected: true, load_kind: 'initial' },
    ],
  }), false);

  const rejectedWithPendingFlag = m.buildRouteLoadAcceptanceState({
    load_picking_id: 20,
    load_pickings: [
      { picking_id: 20, state: 'assigned', accepted: false, rejected: true, load_kind: 'initial' },
    ],
    pending_loads: [
      { picking_id: 20, state: 'assigned', accepted: false, rejected: true, load_kind: 'initial' },
    ],
  });
  assert.equal(rejectedWithPendingFlag.hasPendingLoad, false, 'rejected must not remain pending');

  const acceptedThenRefill = m.buildInitialLoadAcceptanceState({
    load_picking_id: 80,
    load_pickings: [
      { picking_id: 80, load_kind: 'initial', accepted: true },
      { picking_id: 81, load_kind: 'refill', accepted: false, rejected: true, state: 'assigned' },
    ],
    rejected_loads: [
      { picking_id: 81, load_kind: 'refill', rejected: true, state: 'assigned' },
    ],
  });
  assert.equal(acceptedThenRefill.initialLoadAccepted, true, 'rejected refill must not clear initial acceptance');
  assert.equal(acceptedThenRefill.initialLoadRejectedWaiting, false);
}

function testRejectPayload(m: RouteLoadAcceptanceModule) {
  assert.deepEqual(m.buildRouteLoadRejectPayload({
    planId: 1061,
    pickingId: 12410,
    operationId: '11111111-1111-4111-8111-111111111111',
    rejectionReasonCode: 'wrong_quantity',
    rejectionNotes: 'faltan 2 cajas',
  }), {
    operation_id: '11111111-1111-4111-8111-111111111111',
    plan_id: 1061,
    picking_id: 12410,
    rejection_reason_code: 'wrong_quantity',
    rejection_notes: 'faltan 2 cajas',
  });

  assert.throws(
    () => m.buildRouteLoadRejectPayload({
      planId: 1,
      pickingId: 2,
      operationId: 'op',
      rejectionReasonCode: 'other',
    }),
    /nota/i,
  );
  assert.throws(
    () => m.buildRouteLoadRejectPayload({
      planId: 1,
      pickingId: 2,
      operationId: 'op',
      rejectionReasonCode: 'not_a_real_code',
    }),
    /inválido/i,
  );
}

function testSaleStartUsesInitialLoadReadiness(m: RouteLoadAcceptanceModule) {
  assert.equal(m.canStartSaleWithRouteLoad({
    load_picking_id: 80,
    load_pickings: [
      { picking_id: 80, load_kind: 'initial', accepted: true },
      { picking_id: 81, load_kind: 'refill', accepted: false, state: 'assigned' },
    ],
    pending_loads: [
      { picking_id: 81, load_kind: 'refill', accepted: false, state: 'assigned' },
    ],
  }), true);

  assert.equal(m.canStartSaleWithRouteLoad({
    load_picking_id: 20,
    load_pickings: [
      { picking_id: 20, load_kind: 'initial', accepted: false, state: 'assigned' },
    ],
    pending_loads: [
      { picking_id: 20, load_kind: 'initial', accepted: false, state: 'assigned' },
    ],
  }), false);
}

function testDetectsMultiplePendingRefills(m: RouteLoadAcceptanceModule) {
  const plan = {
    plan_id: 1061,
    load_picking_id: 12410,
    load_pickings: [
      { picking_id: 12410, name: 'CIGU/OUT/02378', state: 'done', accepted: true, load_kind: 'initial' },
      { picking_id: 12426, name: 'CIGU/INT/00061', state: 'done', accepted: true, load_kind: 'refill' },
      {
        picking_id: 12431,
        name: 'CIGU/INT/00062',
        state: 'assigned',
        accepted: false,
        load_kind: 'refill',
        lines: [{ product_id: 749, product_name: 'KOLD BARRITA 12 KG', requested_qty: 1, done_qty: 1, uom_name: 'Units' }],
      },
      { picking_id: 12432, name: 'CIGU/INT/00063', state: 'confirmed', accepted: false, load_kind: 'refill' },
    ],
    pending_loads: [
      {
        picking_id: 12431,
        name: 'CIGU/INT/00062',
        state: 'assigned',
        accepted: false,
        load_kind: 'refill',
        lines: [{ product_id: 749, product_name: 'KOLD BARRITA 12 KG', requested_qty: 1, done_qty: 1, uom_name: 'Units' }],
      },
      { picking_id: 12432, name: 'CIGU/INT/00063', state: 'confirmed', accepted: false, load_kind: 'refill' },
    ],
  };

  const state = m.buildRouteLoadAcceptanceState(plan);
  assert.equal(state.hasPendingLoad, true);
  assert.equal(state.pendingLoads.length, 2);
  assert.equal(state.acceptedLoads.length, 2);
  assert.equal(state.nextPendingLoad?.picking_id, 12431);
  assert.equal(state.nextPendingLoad?.isRefill, true);
  assert.equal(state.nextPendingLoad?.lines[0]?.product_id, 749);
  assert.equal(state.nextPendingLoad?.lines[0]?.product_name, 'KOLD BARRITA 12 KG');
  assert.equal(state.nextPendingLoad?.lines[0]?.requested_qty, 1);
  assert.equal(state.nextPendingLoad?.lines[0]?.done_qty, 1);
  assert.equal(state.nextPendingLoad?.lines[0]?.uom_name, 'Units');
}

function testBlocksSaleWhenLoadIsPending(m: RouteLoadAcceptanceModule) {
  assert.equal(m.canStartSaleWithRouteLoad({
    plan_id: 10,
    pending_loads: [{ picking_id: 20, state: 'assigned', accepted: false, load_kind: 'initial' }],
  }), false);

  assert.equal(m.canStartSaleWithRouteLoad({
    plan_id: 10,
    load_pickings: [{ picking_id: 20, state: 'done', accepted: true, load_kind: 'initial' }],
    pending_loads: [],
  }), true);
}

function testIgnoresAcceptedDoneEntriesInPendingLoads(m: RouteLoadAcceptanceModule) {
  const state = m.buildRouteLoadAcceptanceState({
    plan_id: 10,
    load_pickings: [
      { picking_id: 20, name: 'CIGU/OUT/00020', state: 'done', accepted: true, load_kind: 'initial' },
    ],
    pending_loads: [
      { picking_id: 20, name: 'CIGU/OUT/00020', state: 'done', accepted: true, load_kind: 'initial' },
    ],
  });

  assert.equal(state.hasPendingLoad, false);
  assert.equal(state.pendingLoads.length, 0);
  assert.equal(m.canStartSaleWithRouteLoad({
    plan_id: 10,
    pending_loads: [
      { picking_id: 20, name: 'CIGU/OUT/00020', state: 'done', accepted: true, load_kind: 'initial' },
    ],
  }), true);
}

function testAcceptPayloadIncludesSpecificPicking(m: RouteLoadAcceptanceModule) {
  assert.deepEqual(m.buildRouteLoadAcceptPayload(1061, 12431), {
    plan_id: 1061,
    route_plan_id: 1061,
    picking_id: 12431,
  });
}

function testFrontendWiringUsesSharedAcceptanceFlow() {
  const root = resolve();
  const gfLogistics = readFileSync(resolve(root, 'src/services/gfLogistics.ts'), 'utf8');
  const home = readFileSync(resolve(root, 'app/(tabs)/index.tsx'), 'utf8');
  const inventory = readFileSync(resolve(root, 'app/(tabs)/inventory.tsx'), 'utf8');
  const sale = readFileSync(resolve(root, 'app/sale/[stopId].tsx'), 'utf8');
  const routeStart = readFileSync(resolve(root, 'app/route-start.tsx'), 'utf8');
  const refillAccept = readFileSync(resolve(root, 'app/refill-accept.tsx'), 'utf8');
  const routeLoadAcceptanceCard = readFileSync(
    resolve(root, 'src/components/domain/RouteLoadAcceptanceCard.tsx'),
    'utf8',
  );

  assert.match(
    gfLogistics,
    /export async function acceptRouteLoad\(/,
    'gfLogistics debe exponer acceptRouteLoad',
  );
  assert.match(
    gfLogistics,
    /export async function rejectRouteLoad\(/,
    'gfLogistics debe exponer rejectRouteLoad',
  );
  assert.match(
    gfLogistics,
    /\$\{GF_BASE\}\/route_plan\/reject_load/,
    'rejectRouteLoad debe usar gf/logistics/api/employee/route_plan/reject_load',
  );
  assert.doesNotMatch(
    gfLogistics.slice(gfLogistics.indexOf('export async function rejectRouteLoad'), gfLogistics.indexOf('export async function createPayment')),
    /pt_transfer\/reject/,
    'rejectRouteLoad no debe usar PT pt_transfer/reject',
  );
  assert.match(
    home,
    /RouteLoadAcceptanceCard/,
    'Home debe permitir aceptar la carga pendiente desde la app de ventas',
  );
  assert.match(
    inventory,
    /RouteLoadAcceptanceCard/,
    'Inventario debe permitir confirmar cargas y recargas pendientes con la misma lógica de la PWA',
  );
  assert.doesNotMatch(
    inventory,
    /Solicitar Carga|Devolucion|Devolución|Transferencias|router\.push\('\/refill|router\.push\('\/unload|router\.push\('\/transfer/,
    'Inventario no debe exponer botones manuales de carga, devolucion ni transferencias',
  );
  assert.match(
    routeLoadAcceptanceCard,
    /runRouteLoadAcceptAndRefresh/,
    'La tarjeta compartida debe confirmar el picking pendiente vía el flujo R1B-B',
  );
  assert.match(
    routeLoadAcceptanceCard,
    /accept:\s*acceptRouteLoad/,
    'La tarjeta compartida debe llamar acceptRouteLoad con el picking exacto',
  );
  assert.match(
    routeLoadAcceptanceCard,
    /loadProductsAuthoritative/,
    'La tarjeta debe refrescar inventario con evidencia autoritativa (truck_stock)',
  );
  assert.match(
    routeLoadAcceptanceCard,
    /evaluatePlanRefreshEvidence/,
    'La tarjeta debe evaluar frescura del plan tras loadPlan (no Promise resolve)',
  );
  assert.match(
    routeLoadAcceptanceCard,
    /Carga aceptada/,
    'La tarjeta debe mostrar el historial de cargas aceptadas',
  );
  assert.match(
    routeLoadAcceptanceCard,
    /renderLoadLines/,
    'La tarjeta debe renderizar el desglose de productos por picking',
  );
  assert.match(
    inventory,
    /INVENTARIO FÍSICO REAL/,
    'Inventario debe separar el inventario físico real del desglose de carga',
  );
  assert.match(
    sale,
    /canStartSaleWithRouteLoad\(/,
    'La pantalla de venta debe bloquear confirmación cuando haya carga pendiente',
  );
  assert.match(
    routeLoadAcceptanceCard,
    /loadPlan\(\{\s*force:\s*true\s*\}\)/,
    'La tarjeta debe forzar refresh del plan después de aceptar carga',
  );
  assert.match(
    routeStart,
    /loadPlan\(\{\s*force:\s*true\s*\}\)/,
    'Iniciar operación debe forzar refresh del plan después de aceptar carga',
  );
  assert.match(
    refillAccept,
    /loadPlan\(\{\s*force:\s*true\s*\}\)/,
    'Recarga debe forzar refresh del plan después de aceptar carga',
  );
}

async function main() {
  const module = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/routeLoadAcceptance.ts', import.meta.url).pathname
  ) as RouteLoadAcceptanceModule;

  testDetectsMultiplePendingRefills(module);
  testBuildsInitialLoadAcceptanceState(module);
  testRejectedInitialDoesNotCountAsAccepted(module);
  testSaleStartUsesInitialLoadReadiness(module);
  testBlocksSaleWhenLoadIsPending(module);
  testIgnoresAcceptedDoneEntriesInPendingLoads(module);
  testAcceptPayloadIncludesSpecificPicking(module);
  testRejectPayload(module);
  testFrontendWiringUsesSharedAcceptanceFlow();

  console.log('route load acceptance tests: ok');
}

main();
