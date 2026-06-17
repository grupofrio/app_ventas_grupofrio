/**
 * Señales de confianza operativa (trustSignals). Helpers puros: precio/stock
 * referencial, freshness, geo sin distancia ficticia, razones de bloqueo y
 * diferencia de liquidación con monto.
 */
import assert from 'node:assert/strict';

interface Mod {
  describePriceTrust: (i: { isOnline: boolean; hasCustomPrice: boolean }) => { tone: string; label: string };
  describeStockTrust: (i: { isOnline: boolean; hasStockData: boolean | null }) => { tone: string; label: string };
  describeCatalogTrustBanner: (i: { isOnline: boolean; hasStockData: boolean | null; hasCustomPrices: boolean }) => string | null;
  humanizeElapsedMs: (ms: number) => string;
  describeDataFreshness: (i: { preparedAtMs: number | null; nowMs: number; staleAfterMs?: number }) => { label: string; stale: boolean; tone: string };
  describeGeoStatus: (i: {
    locStatus: string; hasClientGeo: boolean; distanceMeters: number | null;
    accuracyMeters?: number | null; withinThresholdMeters?: number; lowAccuracyMeters?: number;
  }) => { tone: string; label: string; withinRange: boolean; distanceKnown: boolean; distanceMeters: number | null };
  describeSaleConfirmBlock: (i: {
    hasLines: boolean; hasStock: boolean; photoTaken: boolean; paymentSelected: boolean;
    hasPlaza: boolean; hasWarehouse: boolean; routeLoadAccepted: boolean;
  }) => string | null;
  describeRetryBlock: (i: { isOnline: boolean; pendingCount: number; isSyncing: boolean }) => string | null;
  describeCashDifference: (i: { captured: number; expected: number }) => { hasDiff: boolean; kind: string; amount: number; label: string; action: string };
}

function testPriceStockTrust(m: Mod) {
  // Precio referencial visible sin conexión.
  const offPrice = m.describePriceTrust({ isOnline: false, hasCustomPrice: true });
  assert.equal(offPrice.tone, 'reference');
  assert.match(offPrice.label, /referencial/i);
  // En línea: cliente vs lista, ambos confirmados.
  assert.equal(m.describePriceTrust({ isOnline: true, hasCustomPrice: true }).tone, 'confirmed');
  assert.match(m.describePriceTrust({ isOnline: true, hasCustomPrice: true }).label, /cliente/i);
  assert.match(m.describePriceTrust({ isOnline: true, hasCustomPrice: false }).label, /lista/i);

  // Stock referencial visible sin conexión o sin stock real de unidad.
  assert.match(m.describeStockTrust({ isOnline: false, hasStockData: true }).label, /referencial/i);
  assert.match(m.describeStockTrust({ isOnline: true, hasStockData: false }).label, /referencial/i);
  assert.match(m.describeStockTrust({ isOnline: true, hasStockData: null }).label, /referencial/i);
  const realStock = m.describeStockTrust({ isOnline: true, hasStockData: true });
  assert.equal(realStock.tone, 'confirmed');
  assert.match(realStock.label, /unidad/i);

  // Banner combinado.
  assert.match(m.describeCatalogTrustBanner({ isOnline: false, hasStockData: true, hasCustomPrices: true }) ?? '', /referencial/i);
  assert.match(m.describeCatalogTrustBanner({ isOnline: true, hasStockData: false, hasCustomPrices: true }) ?? '', /referencial/i);
  // Todo confirmado → sin banner.
  assert.equal(m.describeCatalogTrustBanner({ isOnline: true, hasStockData: true, hasCustomPrices: true }), null);
}

function testFreshness(m: Mod) {
  assert.equal(m.humanizeElapsedMs(30_000), 'menos de 1 min');
  assert.equal(m.humanizeElapsedMs(12 * 60_000), '12 min');
  assert.equal(m.humanizeElapsedMs(60 * 60_000), '1 h');
  assert.equal(m.humanizeElapsedMs(85 * 60_000), '1 h 25 min');

  // Sin preparar.
  const none = m.describeDataFreshness({ preparedAtMs: null, nowMs: 1_000 });
  assert.equal(none.stale, true);
  assert.match(none.label, /sin preparar/i);

  // Fresco (mismo día, 10 min) — usar Date local para no depender de tz.
  const base = new Date(2026, 5, 17, 10, 0, 0).getTime();
  const fresh = m.describeDataFreshness({ preparedAtMs: base, nowMs: base + 10 * 60_000 });
  assert.equal(fresh.stale, false);
  assert.match(fresh.label, /hace 10 min/i);

  // Viejo mismo día (>2h).
  const stale = m.describeDataFreshness({ preparedAtMs: base, nowMs: base + 3 * 60 * 60_000 });
  assert.equal(stale.stale, true);
  assert.match(stale.label, /verifica/i);

  // Otro día.
  const prevDay = new Date(2026, 5, 16, 10, 0, 0).getTime();
  const sameClock = new Date(2026, 5, 17, 10, 0, 0).getTime();
  const otherDay = m.describeDataFreshness({ preparedAtMs: prevDay, nowMs: sameClock });
  assert.equal(otherDay.stale, true);
  assert.match(otherDay.label, /otro día/i);
}

function testGeoNoFictitiousDistance(m: Mod) {
  // Sin geo del cliente → no disponible, NO 999.
  const noGeo = m.describeGeoStatus({ locStatus: 'ready', hasClientGeo: false, distanceMeters: null });
  assert.equal(noGeo.tone, 'unknown');
  assert.equal(noGeo.distanceKnown, false);
  assert.doesNotMatch(noGeo.label, /999/);
  assert.match(noGeo.label, /no disponible/i);

  // GPS no listo → no disponible, NO 999.
  const noFix = m.describeGeoStatus({ locStatus: 'loading', hasClientGeo: true, distanceMeters: null });
  assert.equal(noFix.distanceKnown, false);
  assert.doesNotMatch(noFix.label, /999/);

  // Denegado → razón clara.
  assert.match(m.describeGeoStatus({ locStatus: 'denied', hasClientGeo: true, distanceMeters: null }).label, /denegad/i);

  // Dentro de rango.
  const ok = m.describeGeoStatus({ locStatus: 'ready', hasClientGeo: true, distanceMeters: 30, accuracyMeters: 10 });
  assert.equal(ok.tone, 'ok');
  assert.equal(ok.withinRange, true);
  assert.match(ok.label, /30m/);

  // Fuera de rango.
  const far = m.describeGeoStatus({ locStatus: 'ready', hasClientGeo: true, distanceMeters: 500, accuracyMeters: 10 });
  assert.equal(far.tone, 'far');
  assert.equal(far.withinRange, false);
  assert.match(far.label, /500m/);

  // Precisión baja.
  const low = m.describeGeoStatus({ locStatus: 'ready', hasClientGeo: true, distanceMeters: 40, accuracyMeters: 200 });
  assert.equal(low.tone, 'low_accuracy');
  assert.match(low.label, /precisión/i);
  assert.match(low.label, /±200m/);
}

function testDisabledReasons(m: Mod) {
  // Sin líneas → null (no se muestra hint).
  assert.equal(m.describeSaleConfirmBlock({
    hasLines: false, hasStock: true, photoTaken: true, paymentSelected: true,
    hasPlaza: true, hasWarehouse: true, routeLoadAccepted: true,
  }), null);
  // Todo OK → null.
  assert.equal(m.describeSaleConfirmBlock({
    hasLines: true, hasStock: true, photoTaken: true, paymentSelected: true,
    hasPlaza: true, hasWarehouse: true, routeLoadAccepted: true,
  }), null);
  // Orden de prioridad: stock → foto → pago.
  assert.match(m.describeSaleConfirmBlock({
    hasLines: true, hasStock: false, photoTaken: false, paymentSelected: false,
    hasPlaza: true, hasWarehouse: true, routeLoadAccepted: true,
  }) ?? '', /stock/i);
  assert.match(m.describeSaleConfirmBlock({
    hasLines: true, hasStock: true, photoTaken: false, paymentSelected: false,
    hasPlaza: true, hasWarehouse: true, routeLoadAccepted: true,
  }) ?? '', /foto/i);
  assert.match(m.describeSaleConfirmBlock({
    hasLines: true, hasStock: true, photoTaken: true, paymentSelected: false,
    hasPlaza: true, hasWarehouse: true, routeLoadAccepted: true,
  }) ?? '', /pago/i);

  // Retry.
  assert.match(m.describeRetryBlock({ isOnline: true, pendingCount: 1, isSyncing: true }) ?? '', /sincronizando/i);
  assert.match(m.describeRetryBlock({ isOnline: false, pendingCount: 1, isSyncing: false }) ?? '', /sin conexión/i);
  assert.match(m.describeRetryBlock({ isOnline: true, pendingCount: 0, isSyncing: false }) ?? '', /no hay/i);
  assert.equal(m.describeRetryBlock({ isOnline: true, pendingCount: 2, isSyncing: false }), null);
}

function testCashDifference(m: Mod) {
  const falta = m.describeCashDifference({ captured: 950, expected: 1000 });
  assert.equal(falta.hasDiff, true);
  assert.equal(falta.kind, 'falta');
  assert.equal(falta.amount, 50);
  assert.match(falta.label, /Faltan/);
  assert.match(falta.label, /\$50\.00/);
  assert.match(falta.action, /.+/);

  const sobra = m.describeCashDifference({ captured: 1100, expected: 1000 });
  assert.equal(sobra.kind, 'sobra');
  assert.equal(sobra.amount, 100);
  assert.match(sobra.label, /Sobran/);

  const cuadra = m.describeCashDifference({ captured: 1000, expected: 1000 });
  assert.equal(cuadra.hasDiff, false);
  assert.equal(cuadra.kind, 'cuadra');
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta solo en runtime de test.
    new URL('../src/services/trustSignals.ts', import.meta.url).pathname
  ) as Mod;
  testPriceStockTrust(m);
  testFreshness(m);
  testGeoNoFictitiousDistance(m);
  testDisabledReasons(m);
  testCashDifference(m);
  console.log('trust signals tests: ok');
}
void main();
