import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve();

interface VisitTelemetryModule {
  visitTelemetryCounters: {
    reconcileResetTotal: number;
    guardGhostSuppressedTotal: number;
  };
  resetVisitTelemetryCounters: () => void;
}

function testCountersStartAtZero(m: VisitTelemetryModule) {
  m.resetVisitTelemetryCounters();
  assert.equal(m.visitTelemetryCounters.reconcileResetTotal, 0);
  assert.equal(m.visitTelemetryCounters.guardGhostSuppressedTotal, 0);
}

function testCountersAreMutable(m: VisitTelemetryModule) {
  m.resetVisitTelemetryCounters();
  m.visitTelemetryCounters.reconcileResetTotal += 1;
  m.visitTelemetryCounters.guardGhostSuppressedTotal += 3;
  assert.equal(m.visitTelemetryCounters.reconcileResetTotal, 1);
  assert.equal(m.visitTelemetryCounters.guardGhostSuppressedTotal, 3);
  m.resetVisitTelemetryCounters();
  assert.equal(m.visitTelemetryCounters.reconcileResetTotal, 0);
  assert.equal(m.visitTelemetryCounters.guardGhostSuppressedTotal, 0);
}

function testCallSitesAreWired() {
  // Source-level guards to make sure the counters and log events are
  // actually wired at their two expected call sites. If someone removes
  // one of them the ghost-stop telemetry silently stops — these asserts
  // fail loudly instead.
  const routeStore = readFileSync(
    resolve(REPO_ROOT, 'src/stores/useRouteStore.ts'),
    'utf8',
  );
  const stopScreen = readFileSync(
    resolve(REPO_ROOT, 'app/stop/[stopId].tsx'),
    'utf8',
  );

  assert.match(
    routeStore,
    /visitTelemetryCounters\.reconcileResetTotal\s*\+=\s*1/,
    'loadPlan must increment reconcileResetTotal when it resets a ghost visit',
  );
  assert.match(
    routeStore,
    /logInfo\('visit',\s*'reconcile_reset'/,
    'loadPlan must emit visit.reconcile_reset log event',
  );
  assert.match(
    stopScreen,
    /visitTelemetryCounters\.guardGhostSuppressedTotal\s*\+=\s*1/,
    'stop screen must increment guardGhostSuppressedTotal on ghost state',
  );
  assert.match(
    stopScreen,
    /logInfo\('visit',\s*'guard_ghost_suppressed'/,
    'stop screen must emit visit.guard_ghost_suppressed log event',
  );
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/utils/visitTelemetry.ts', import.meta.url).pathname
  ) as VisitTelemetryModule;

  testCountersStartAtZero(m);
  testCountersAreMutable(m);
  testCallSitesAreWired();
  console.log('visit telemetry tests: ok');
}

void main();
