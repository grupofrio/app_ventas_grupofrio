/**
 * Pure tests for routePreparationLogic + cashcloseGuard.
 *
 * The store (useRoutePreparationStore) imports zustand + react-native via
 * other stores, so we can't load it from a plain node test runner. The
 * logic that matters most — partner dedup, freshness check, guard
 * predicates — lives in pure helpers and is exercised here.
 */

import assert from 'node:assert/strict';

interface RoutePrepLogicModule {
  dedupePartnerIds: (stops: any[]) => number[];
  buildCustomerNameMap: (stops: any[]) => Map<number, string>;
  isPreparationFreshForPlan: (preparedPlanId: number | null, currentPlanId: number | null | undefined) => boolean;
  formatPreparedAt: (ts: number | null) => string;
}

interface CashCloseGuardModule {
  canConfirmLiquidation: (input: {
    pendingCount: number;
    isSyncing: boolean;
    liquidationAvailable: boolean;
  }) => boolean;
  describeBlockingReason: (input: {
    pendingCount: number;
    isSyncing: boolean;
    liquidationAvailable: boolean;
  }) => string | null;
}

function testDedupeFiltersInvalidIds(m: RoutePrepLogicModule) {
  const stops = [
    { customer_id: 10, customer_name: 'A' },
    { customer_id: 10, customer_name: 'A' }, // dup
    { customer_id: null, customer_name: 'X' },
    { customer_id: -1, customer_name: 'Y' },
    { customer_id: 0, customer_name: 'Z' },
    { customer_id: 20, customer_name: 'B' },
    {}, // missing
  ];
  const out = m.dedupePartnerIds(stops);
  assert.deepEqual(out, [10, 20]);
}

function testDedupePreservesFirstOccurrenceOrder(m: RoutePrepLogicModule) {
  const stops = [
    { customer_id: 99 },
    { customer_id: 1 },
    { customer_id: 50 },
    { customer_id: 1 }, // dup of #1
  ];
  assert.deepEqual(m.dedupePartnerIds(stops), [99, 1, 50]);
}

function testBuildCustomerNameMapKeepsFirstName(m: RoutePrepLogicModule) {
  const stops = [
    { customer_id: 10, customer_name: 'Tienda A' },
    { customer_id: 10, customer_name: 'Tienda A — alterno' }, // ignored
    { customer_id: 20, customer_name: 'Tienda B' },
    { customer_id: 30 }, // no name → not added
  ];
  const map = m.buildCustomerNameMap(stops);
  assert.equal(map.get(10), 'Tienda A');
  assert.equal(map.get(20), 'Tienda B');
  assert.equal(map.has(30), false);
}

function testFreshnessIsPlanScoped(m: RoutePrepLogicModule) {
  assert.equal(m.isPreparationFreshForPlan(null, 5), false, 'never prepared → not fresh');
  assert.equal(m.isPreparationFreshForPlan(5, null), false, 'no current plan → not fresh');
  assert.equal(m.isPreparationFreshForPlan(5, undefined), false, 'undef current plan → not fresh');
  assert.equal(m.isPreparationFreshForPlan(5, 5), true, 'same plan → fresh');
  assert.equal(m.isPreparationFreshForPlan(5, 6), false, 'plan changed → stale');
}

function testFormatPreparedAtPadsTwoDigits(m: RoutePrepLogicModule) {
  // Construct a Date locally so we don't depend on tz.
  const d = new Date(2026, 4, 5, 9, 7); // 09:07 local
  assert.equal(m.formatPreparedAt(d.getTime()), '09:07');
  assert.equal(m.formatPreparedAt(null), '');
}

function testGuardBlocksWhenPendingExists(g: CashCloseGuardModule) {
  assert.equal(g.canConfirmLiquidation({
    pendingCount: 3, isSyncing: false, liquidationAvailable: true,
  }), false);
  const reason = g.describeBlockingReason({
    pendingCount: 3, isSyncing: false, liquidationAvailable: true,
  });
  assert.ok(reason && reason.includes('3'));
}

function testGuardBlocksWhileSyncing(g: CashCloseGuardModule) {
  assert.equal(g.canConfirmLiquidation({
    pendingCount: 0, isSyncing: true, liquidationAvailable: true,
  }), false);
  assert.equal(g.describeBlockingReason({
    pendingCount: 0, isSyncing: true, liquidationAvailable: true,
  }), 'Sincronizando…');
}

function testGuardBlocksWithoutLiquidation(g: CashCloseGuardModule) {
  assert.equal(g.canConfirmLiquidation({
    pendingCount: 0, isSyncing: false, liquidationAvailable: false,
  }), false);
}

function testGuardAllowsWhenAllClear(g: CashCloseGuardModule) {
  assert.equal(g.canConfirmLiquidation({
    pendingCount: 0, isSyncing: false, liquidationAvailable: true,
  }), true);
  assert.equal(g.describeBlockingReason({
    pendingCount: 0, isSyncing: false, liquidationAvailable: true,
  }), null);
}

async function main() {
  const logic = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/routePreparationLogic.ts', import.meta.url).pathname
  ) as RoutePrepLogicModule;
  const guard = await import(
    // @ts-ignore
    new URL('../src/services/cashcloseGuard.ts', import.meta.url).pathname
  ) as CashCloseGuardModule;

  testDedupeFiltersInvalidIds(logic);
  testDedupePreservesFirstOccurrenceOrder(logic);
  testBuildCustomerNameMapKeepsFirstName(logic);
  testFreshnessIsPlanScoped(logic);
  testFormatPreparedAtPadsTwoDigits(logic);

  testGuardBlocksWhenPendingExists(guard);
  testGuardBlocksWhileSyncing(guard);
  testGuardBlocksWithoutLiquidation(guard);
  testGuardAllowsWhenAllClear(guard);

  console.log('route preparation + cashclose guard tests: ok');
}

void main();
