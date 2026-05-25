import assert from 'node:assert/strict';

interface RouteStopsModule {
  removeStopById: (
    stops: Array<{ id: number; state: string }>,
    stopId: number,
  ) => Array<{ id: number; state: string }>;
  filterPlannedStopsBySearch: (
    stops: Array<{
      id: number;
      customer_id: number;
      customer_name: string;
      customer_ref?: string;
      contact_name?: string;
      phone?: string;
      mobile?: string;
      email?: string;
      route_sequence?: number;
      _isOffroute?: boolean;
    }>,
    query: string,
  ) => Array<{
    id: number;
    customer_id: number;
    customer_name: string;
    customer_ref?: string;
    contact_name?: string;
    phone?: string;
    mobile?: string;
    email?: string;
    route_sequence?: number;
    _isOffroute?: boolean;
  }>;
}

function testRemoveStopById(module: RouteStopsModule) {
  const result = module.removeStopById(
    [
      { id: 10, state: 'pending' },
      { id: -99, state: 'done' },
      { id: 11, state: 'in_progress' },
    ],
    -99,
  );

  assert.deepEqual(result, [
    { id: 10, state: 'pending' },
    { id: 11, state: 'in_progress' },
  ]);
}

function testRemoveStopByIdNoopWhenMissing(module: RouteStopsModule) {
  const input = [
    { id: 10, state: 'pending' },
    { id: 11, state: 'in_progress' },
  ];
  const result = module.removeStopById(input, 999);
  assert.deepEqual(result, input);
}

function testFilterPlannedStopsBySearchIncludesAllPlannedStates(module: RouteStopsModule) {
  const result = module.filterPlannedStopsBySearch(
    [
      { id: 1, customer_id: 100, customer_name: 'Abarrotes Norte', route_sequence: 1 },
      { id: 2, customer_id: 101, customer_name: 'Tienda Sur', customer_ref: 'SUR-01', route_sequence: 2 },
      { id: 3, customer_id: 102, customer_name: 'Mini Super Norte', phone: '555-0102', route_sequence: 3 },
      { id: -4, customer_id: 103, customer_name: 'Prospecto Norte', route_sequence: 999, _isOffroute: true },
    ],
    'norte',
  );

  assert.deepEqual(
    result.map((stop) => stop.id),
    [1, 3],
    'debe buscar en todos los clientes planificados y excluir visitas especiales',
  );
}

function testFilterPlannedStopsBySearchUsesReferenceAndPhone(module: RouteStopsModule) {
  const result = module.filterPlannedStopsBySearch(
    [
      { id: 1, customer_id: 100, customer_name: 'Abarrotes Norte', route_sequence: 1 },
      { id: 2, customer_id: 101, customer_name: 'Tienda Sur', customer_ref: 'SUR-01', route_sequence: 2 },
      { id: 3, customer_id: 102, customer_name: 'Mini Super', phone: '555-0102', route_sequence: 3 },
    ],
    '0102',
  );

  assert.deepEqual(result.map((stop) => stop.id), [3]);
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/routeStops.ts', import.meta.url).pathname
  ) as RouteStopsModule;

  testRemoveStopById(module);
  testRemoveStopByIdNoopWhenMissing(module);
  testFilterPlannedStopsBySearchIncludesAllPlannedStates(module);
  testFilterPlannedStopsBySearchUsesReferenceAndPhone(module);
  console.log('route stops tests: ok');
}

void main();
