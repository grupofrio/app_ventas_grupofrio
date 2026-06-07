/**
 * Tests for routeMapLogic — map-first route helpers.
 */

import assert from 'node:assert/strict';
import type { GFStop, StopState } from '../src/types/plan';

interface MapLogicModule {
  selectNextStop: (stops: GFStop[]) => GFStop | null;
  resolveSelectedStop: (prevId: number | null, stops: GFStop[]) => number | null;
  splitStopsByLocation: (stops: GFStop[]) => { located: GFStop[]; unlocated: GFStop[] };
  computeRouteProgress: (stops: GFStop[]) => { total: number; visited: number; pending: number; pct: number; completed: boolean };
  haversineMeters: (aLat: number, aLon: number, bLat: number, bLon: number) => number;
  distanceToStop: (userLat: number | null | undefined, userLon: number | null | undefined, stop: GFStop) => number | null;
  formatDistance: (m: number | null | undefined) => string;
  stopStatusMeta: (s: StopState | string) => { label: string; color: string };
}

function mk(partial: Partial<GFStop> & { id: number; state: StopState }): GFStop {
  return {
    id: partial.id,
    customer_id: partial.customer_id ?? partial.id * 10,
    customer_name: partial.customer_name ?? `Cliente ${partial.id}`,
    state: partial.state,
    route_sequence: partial.route_sequence,
    source_model: 'gf.route.stop',
    customer_latitude: partial.customer_latitude,
    customer_longitude: partial.customer_longitude,
  } as GFStop;
}

function testSelectNextStop(m: MapLogicModule) {
  // in_progress wins over pending
  const stops = [
    mk({ id: 1, state: 'pending', route_sequence: 1 }),
    mk({ id: 2, state: 'in_progress', route_sequence: 5 }),
    mk({ id: 3, state: 'pending', route_sequence: 2 }),
  ];
  assert.equal(m.selectNextStop(stops)?.id, 2, 'in_progress is the next');

  // no in_progress → lowest-sequence pending
  const stops2 = [
    mk({ id: 1, state: 'done', route_sequence: 1 }),
    mk({ id: 3, state: 'pending', route_sequence: 3 }),
    mk({ id: 2, state: 'pending', route_sequence: 2 }),
  ];
  assert.equal(m.selectNextStop(stops2)?.id, 2);

  // all done → null
  assert.equal(m.selectNextStop([mk({ id: 1, state: 'done' })]), null);
  assert.equal(m.selectNextStop([]), null);
}

function testResolveSelectedStop(m: MapLogicModule) {
  const stops = [
    mk({ id: 1, state: 'done', route_sequence: 1 }),
    mk({ id: 2, state: 'pending', route_sequence: 2 }),
    mk({ id: 3, state: 'pending', route_sequence: 3 }),
  ];
  // keep manual selection if still pending
  assert.equal(m.resolveSelectedStop(3, stops), 3);
  // previous selection no longer pending (done) → advance to next pending
  assert.equal(m.resolveSelectedStop(1, stops), 2);
  // no previous → next pending
  assert.equal(m.resolveSelectedStop(null, stops), 2);
  // previous id not in list → next pending
  assert.equal(m.resolveSelectedStop(999, stops), 2);
  // all done → null
  assert.equal(m.resolveSelectedStop(1, [mk({ id: 1, state: 'done' })]), null);
  // in_progress manual selection is kept
  const wip = [mk({ id: 5, state: 'in_progress', route_sequence: 5 }), mk({ id: 6, state: 'pending', route_sequence: 1 })];
  assert.equal(m.resolveSelectedStop(5, wip), 5);
}

function testSplitByLocation(m: MapLogicModule) {
  const stops = [
    mk({ id: 1, state: 'pending', customer_latitude: 20.6, customer_longitude: -103.3 }),
    mk({ id: 2, state: 'pending' }), // no coords
    mk({ id: 3, state: 'pending', customer_latitude: 0, customer_longitude: 0 }), // 0,0 treated as no-loc
  ];
  const { located, unlocated } = m.splitStopsByLocation(stops);
  assert.deepEqual(located.map((s) => s.id), [1]);
  assert.deepEqual(unlocated.map((s) => s.id).sort(), [2, 3]);
}

function testProgress(m: MapLogicModule) {
  const stops = [
    mk({ id: 1, state: 'done' }),
    mk({ id: 2, state: 'not_visited' }), // counts as visited
    mk({ id: 3, state: 'pending' }),
    mk({ id: 4, state: 'in_progress' }),
  ];
  const p = m.computeRouteProgress(stops);
  assert.equal(p.total, 4);
  assert.equal(p.visited, 2);
  assert.equal(p.pending, 2);
  assert.equal(p.pct, 50);
  assert.equal(p.completed, false);

  const allDone = m.computeRouteProgress([mk({ id: 1, state: 'done' }), mk({ id: 2, state: 'closed' })]);
  assert.equal(allDone.completed, true);
  assert.equal(allDone.pct, 100);

  assert.equal(m.computeRouteProgress([]).completed, false);
}

function testDistance(m: MapLogicModule) {
  // ~111 km per degree latitude near equator-ish
  const d = m.haversineMeters(20.0, -103.0, 20.01, -103.0);
  assert.ok(d > 1000 && d < 1200, `~1.1km expected, got ${d}`);

  const stop = mk({ id: 1, state: 'pending', customer_latitude: 20.01, customer_longitude: -103.0 });
  assert.ok((m.distanceToStop(20.0, -103.0, stop) ?? 0) > 1000);
  assert.equal(m.distanceToStop(null, -103.0, stop), null);
  assert.equal(m.distanceToStop(20.0, -103.0, mk({ id: 2, state: 'pending' })), null);
}

function testFormatDistance(m: MapLogicModule) {
  assert.equal(m.formatDistance(850), '850 m');
  assert.equal(m.formatDistance(2400), '2.4 km');
  assert.equal(m.formatDistance(0), '0 m');
  assert.equal(m.formatDistance(null), '');
  assert.equal(m.formatDistance(-5), '');
}

function testStatusMeta(m: MapLogicModule) {
  assert.equal(m.stopStatusMeta('done').label, 'Visitado');
  assert.equal(m.stopStatusMeta('pending').label, 'Pendiente');
  assert.ok(m.stopStatusMeta('weird').color); // graceful fallback
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/routeMapLogic.ts', import.meta.url).pathname
  ) as MapLogicModule;

  testSelectNextStop(m);
  testResolveSelectedStop(m);
  testSplitByLocation(m);
  testProgress(m);
  testDistance(m);
  testFormatDistance(m);
  testStatusMeta(m);

  console.log('route map logic tests: ok');
}

void main();
