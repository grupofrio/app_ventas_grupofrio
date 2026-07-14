import assert from 'node:assert/strict';

interface RouteStartAuthorityModule {
  deriveRouteStartPlanSnapshot: (plan: any) => {
    planId: number;
    planState: string;
    kmInitial: number | null;
    initialLoadAccepted: boolean;
  };
}

async function main() {
  const module = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/routeStartAuthority.ts', import.meta.url).pathname
  ) as RouteStartAuthorityModule;

  const aleman = module.deriveRouteStartPlanSnapshot({
    plan_id: 6466,
    state: 'in_progress',
    departure_km: 399728,
    load_picking_id: 80,
    load_pickings: [{ picking_id: 80, load_kind: 'initial', accepted: true }],
  });

  assert.deepEqual(aleman, {
    planId: 6466,
    planState: 'in_progress',
    kmInitial: 399728,
    initialLoadAccepted: true,
  });

  for (const departureKm of [null, 0, -1, Number.NaN]) {
    const snapshot = module.deriveRouteStartPlanSnapshot({
      plan_id: 2,
      state: 'published',
      departure_km: departureKm,
      load_pickings: [],
    });
    assert.equal(snapshot.kmInitial, null);
  }

  console.log('route start authority tests: ok');
}

main();
