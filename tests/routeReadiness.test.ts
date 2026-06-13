/**
 * Perf Fase 2C — gate de salida (readiness de preparación de ruta).
 *
 * Mínimo bloqueante = ruta + productos. Precios = best-effort (advertencia, no
 * bloqueo). Nunca inventa datos.
 */
import assert from 'node:assert/strict';

interface Mod {
  computeRouteReadiness: (input: {
    hasPlan: boolean;
    stopsCount: number;
    productCount: number;
    customersTotal: number;
    customersPrepared: number;
  }) => {
    route: string; products: string; prices: string;
    minimumReady: boolean; fullyReady: boolean;
    missing: string[]; warnings: string[]; blockReason: string | null;
  };
}

function run(m: Mod) {
  // Preparación completa → habilita salida.
  const full = m.computeRouteReadiness({
    hasPlan: true, stopsCount: 10, productCount: 50, customersTotal: 10, customersPrepared: 10,
  });
  assert.equal(full.minimumReady, true);
  assert.equal(full.fullyReady, true);
  assert.equal(full.blockReason, null);
  assert.deepEqual(full.missing, []);

  // Faltan productos → bloqueo.
  const noProducts = m.computeRouteReadiness({
    hasPlan: true, stopsCount: 10, productCount: 0, customersTotal: 10, customersPrepared: 0,
  });
  assert.equal(noProducts.minimumReady, false);
  assert.equal(noProducts.products, 'missing');
  assert.ok(noProducts.missing.includes('productos'));
  assert.ok(noProducts.blockReason && noProducts.blockReason.includes('productos'));

  // Falta ruta → bloqueo.
  const noRoute = m.computeRouteReadiness({
    hasPlan: false, stopsCount: 0, productCount: 50, customersTotal: 0, customersPrepared: 0,
  });
  assert.equal(noRoute.minimumReady, false);
  assert.equal(noRoute.route, 'missing');

  // Precios parciales → mínimo listo (NO bloquea) pero con advertencia.
  const partialPrices = m.computeRouteReadiness({
    hasPlan: true, stopsCount: 10, productCount: 50, customersTotal: 10, customersPrepared: 4,
  });
  assert.equal(partialPrices.minimumReady, true, 'precios parciales no bloquean salida');
  assert.equal(partialPrices.fullyReady, false);
  assert.equal(partialPrices.prices, 'partial');
  assert.ok(partialPrices.warnings.length > 0);
  assert.equal(partialPrices.blockReason, null);

  // Precios ausentes pero con productos → mínimo listo, advertencia.
  const noPrices = m.computeRouteReadiness({
    hasPlan: true, stopsCount: 10, productCount: 50, customersTotal: 10, customersPrepared: 0,
  });
  assert.equal(noPrices.minimumReady, true);
  assert.equal(noPrices.prices, 'missing');
  assert.ok(noPrices.warnings.length > 0);

  // Sin clientes que precargar → precios 'ok' (nada que hacer).
  const noCustomers = m.computeRouteReadiness({
    hasPlan: true, stopsCount: 3, productCount: 50, customersTotal: 0, customersPrepared: 0,
  });
  assert.equal(noCustomers.prices, 'ok');
  assert.equal(noCustomers.fullyReady, true);

  console.log('routeReadiness tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/routeReadiness.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
