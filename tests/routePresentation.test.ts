import assert from 'node:assert/strict';

interface RoutePresentationModule {
  getPlanTypeLabel: (generationMode?: string | null) => string | null;
  getStopTypeLabel: (stop: {
    _entityType?: 'customer' | 'lead';
    _isOffroute?: boolean;
  }) => string | null;
}

function testPlanTypeLabel(module: RoutePresentationModule) {
  assert.equal(module.getPlanTypeLabel('lead_route'), 'Ruta de prospectos');
  assert.equal(module.getPlanTypeLabel('customer_daily'), 'Ruta de clientes');
  assert.equal(module.getPlanTypeLabel(undefined), null);
}

function testStopTypeLabel(module: RoutePresentationModule) {
  assert.equal(
    module.getStopTypeLabel({ _entityType: 'lead', _isOffroute: true }),
    'Prospecto especial',
  );
  assert.equal(
    module.getStopTypeLabel({ _entityType: 'customer', _isOffroute: true }),
    'Cliente especial',
  );
  assert.equal(
    module.getStopTypeLabel({ _entityType: 'lead', _isOffroute: false }),
    'Prospecto',
  );
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/routePresentation.ts', import.meta.url).pathname
  ) as RoutePresentationModule;

  testPlanTypeLabel(module);
  testStopTypeLabel(module);
  console.log('route presentation tests: ok');
}

void main();
