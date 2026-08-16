/**
 * R1B-B load/refill accept flow — behavioral + contract tests.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  createPickingAcceptFlightGate,
  describeRouteLoadAcceptSuccess,
  parseRouteLoadAcceptResponse,
  requirePositivePickingId,
  runRouteLoadAcceptAndRefresh,
} from '../src/services/routeLoadAcceptFlow.ts';
import { buildRouteLoadAcceptPayload, buildRouteLoadAcceptanceState } from '../src/services/routeLoadAcceptance.ts';
import {
  applySaleStockViaLedger,
} from '../src/services/inventoryLedgerAdapters.ts';
import {
  createMemoryLedgerPorts,
  rebaseLedgerFromServerSnapshot,
} from '../src/services/inventoryLedgerLogic.ts';
import { migrateLegacySellableSnapshot } from '../src/domain/inventory/ledgerState.ts';
import { keepLedgerOperationIdsForSnapshot } from '../src/services/ambiguousAckReconcile.ts';

const root = resolve(process.cwd());

describe('R1B-B parseRouteLoadAcceptResponse', () => {
  it('treats ok + idempotent_replay as success without string matching', () => {
    const parsed = parseRouteLoadAcceptResponse(
      {
        ok: true,
        message: 'Carga ya aceptada (replay idempotente)',
        data: {
          plan_id: 10,
          picking_id: 55,
          idempotent_replay: true,
          already_accepted: true,
          load_kind: 'refill',
        },
      },
      { plan_id: 10, picking_id: 55 },
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.idempotent_replay, true);
    assert.equal(parsed.already_accepted, true);
    assert.equal(parsed.picking_id, 55);
  });

  it('rejects non-ok bodies', () => {
    assert.throws(
      () => parseRouteLoadAcceptResponse({ ok: false, message: 'fail' }, { plan_id: 1, picking_id: 2 }),
      /fail/,
    );
  });
});

describe('R1B-B runRouteLoadAcceptAndRefresh', () => {
  it('A: first accept → plan + truck_stock refresh; no local invent', async () => {
    const calls: string[] = [];
    const outcome = await runRouteLoadAcceptAndRefresh({
      planId: 100,
      pickingId: 200,
      warehouseId: 7,
      isOnline: true,
      accept: async (planId, pickingId) => {
        calls.push(`accept:${planId}:${pickingId}`);
        return {
          ok: true,
          idempotent_replay: false,
          already_accepted: false,
          plan_id: planId,
          picking_id: pickingId,
        };
      },
      refreshPlan: async () => {
        calls.push('plan');
      },
      refreshInventory: async (wid) => {
        calls.push(`inv:${wid}`);
      },
    });
    assert.deepEqual(calls, ['accept:100:200', 'plan', 'inv:7']);
    assert.equal(outcome.accept.ok, true);
    assert.equal(outcome.inventoryRefreshOk, true);
  });

  it('C/D: lost-response retry uses SAME picking_id; replay is normal success', async () => {
    const sent: Array<{ planId: number; pickingId: number }> = [];
    let attempt = 0;
    const accept = async (planId: number, pickingId: number) => {
      sent.push({ planId, pickingId });
      attempt += 1;
      if (attempt === 1) throw new Error('network timeout');
      return {
        ok: true,
        idempotent_replay: true,
        already_accepted: true,
        plan_id: planId,
        picking_id: pickingId,
        load_kind: 'initial',
      };
    };

    await assert.rejects(
      () => runRouteLoadAcceptAndRefresh({
        planId: 1,
        pickingId: 99,
        warehouseId: 3,
        isOnline: true,
        accept,
        refreshPlan: async () => undefined,
        refreshInventory: async () => undefined,
      }),
      /network timeout/,
    );

    const replay = await runRouteLoadAcceptAndRefresh({
      planId: 1,
      pickingId: 99,
      warehouseId: 3,
      isOnline: true,
      accept,
      refreshPlan: async () => undefined,
      refreshInventory: async () => undefined,
    });
    assert.deepEqual(sent, [
      { planId: 1, pickingId: 99 },
      { planId: 1, pickingId: 99 },
    ]);
    assert.equal(replay.accept.idempotent_replay, true);
    assert.equal(replay.inventoryRefreshOk, true);
    const copy = describeRouteLoadAcceptSuccess({
      isRefill: false,
      pickingName: 'WH/OUT/1',
      idempotentReplay: true,
      inventoryRefreshOk: true,
    });
    assert.match(copy.body, /ya estaba confirmada/i);
  });

  it('E: accept success + inventory refresh failure does not invent qty / does not fail accept', async () => {
    const outcome = await runRouteLoadAcceptAndRefresh({
      planId: 5,
      pickingId: 6,
      warehouseId: 9,
      isOnline: true,
      accept: async () => ({
        ok: true,
        idempotent_replay: false,
        already_accepted: false,
        plan_id: 5,
        picking_id: 6,
      }),
      refreshPlan: async () => undefined,
      refreshInventory: async () => {
        throw new Error('truck_stock down');
      },
    });
    assert.equal(outcome.accept.ok, true);
    assert.equal(outcome.inventoryRefreshOk, false);
    assert.match(outcome.inventoryRefreshError || '', /truck_stock/);
    const copy = describeRouteLoadAcceptSuccess({
      isRefill: true,
      pickingName: 'REFILL/2',
      idempotentReplay: false,
      inventoryRefreshOk: false,
    });
    assert.equal(copy.title, 'Recarga aceptada');
    assert.match(copy.body, /no se pudo actualizar el inventario/i);
  });

  it('offline blocks before accept', async () => {
    let accepted = false;
    await assert.rejects(
      () => runRouteLoadAcceptAndRefresh({
        planId: 1,
        pickingId: 2,
        isOnline: false,
        accept: async () => {
          accepted = true;
          return {
            ok: true,
            idempotent_replay: false,
            already_accepted: false,
            plan_id: 1,
            picking_id: 2,
          };
        },
        refreshPlan: async () => undefined,
        refreshInventory: async () => undefined,
      }),
      /Sin conexión/,
    );
    assert.equal(accepted, false);
  });

  it('B: single-flight gate blocks parallel same picking', () => {
    const gate = createPickingAcceptFlightGate();
    assert.equal(gate.tryBegin(44), true);
    assert.equal(gate.tryBegin(44), false);
    assert.equal(gate.tryBegin(45), false);
    gate.end(44);
    assert.equal(gate.tryBegin(45), true);
  });
});

describe('R1B-B multiple refills keep exact picking identity', () => {
  it('A/B: pending cards retain independent picking_ids; payload always includes picking_id', () => {
    const state = buildRouteLoadAcceptanceState({
      load_picking_id: 10,
      load_pickings: [
        { picking_id: 10, load_kind: 'initial', accepted: true, state: 'done' },
        { picking_id: 21, load_kind: 'refill', accepted: false, state: 'assigned' },
        { picking_id: 22, load_kind: 'refill', accepted: false, state: 'assigned' },
      ],
      pending_loads: [
        { picking_id: 21, load_kind: 'refill', accepted: false, state: 'assigned' },
        { picking_id: 22, load_kind: 'refill', accepted: false, state: 'assigned' },
      ],
    });
    assert.equal(state.pendingLoads.length, 2);
    assert.equal(state.nextPendingLoad?.picking_id, 21);
    assert.deepEqual(
      state.pendingLoads.map((c) => c.picking_id),
      [21, 22],
    );
    assert.deepEqual(buildRouteLoadAcceptPayload(1000, 21), {
      plan_id: 1000,
      route_plan_id: 1000,
      picking_id: 21,
    });
    assert.deepEqual(buildRouteLoadAcceptPayload(1000, 22), {
      plan_id: 1000,
      route_plan_id: 1000,
      picking_id: 22,
    });
    assert.throws(() => requirePositivePickingId(0));
  });
});

describe('R1B-B inventory authority: truck_stock baseline, no local +qty load/refill', () => {
  it('refill +20 via snapshot → 70; pending sale -5 → 65; never 90', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 1: 50 }, 'v0', 't0'),
    );
    // Authoritative post-refill truck_stock (server already moved +20).
    await rebaseLedgerFromServerSnapshot(ports, { 1: 70 }, new Set(), 'post-refill');
    assert.equal(ports._sellable[1], 70);

    const saleOp = '00000000-0000-4000-8000-0000000000b1';
    await applySaleStockViaLedger({
      operationId: saleOp,
      lines: [{ product_id: 1, qty: 5 }],
      ports,
    });
    assert.equal(ports._sellable[1], 65);

    // Keep-set without durable ACK would retain sale movement on stale snapshot;
    // here we only prove load/refill did not add a second +20.
    const keep = keepLedgerOperationIdsForSnapshot(
      [{
        id: saleOp,
        type: 'sale_order',
        status: 'pending',
        payload: { operation_id: saleOp },
      }],
      Date.now(),
    );
    assert.equal(keep.has(saleOp), true);
    assert.notEqual(ports._sellable[1], 90);
  });
});

describe('R1B-B wiring contracts', () => {
  it('accept paths always send picking_id and use shared refresh flow', () => {
    const files = [
      'app/route-start.tsx',
      'app/refill-accept.tsx',
      'src/components/domain/RouteLoadAcceptanceCard.tsx',
      'src/services/gfLogistics.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(resolve(root, rel), 'utf8');
      assert.doesNotMatch(
        src,
        /buildInitialLoadMovements/,
        `${rel} must not wire buildInitialLoadMovements`,
      );
      assert.doesNotMatch(
        src,
        /ya\.\*acept\|already/,
        `${rel} must not string-match already-accepted errors`,
      );
    }

    const card = readFileSync(resolve(root, 'src/components/domain/RouteLoadAcceptanceCard.tsx'), 'utf8');
    const routeStart = readFileSync(resolve(root, 'app/route-start.tsx'), 'utf8');
    const refill = readFileSync(resolve(root, 'app/refill-accept.tsx'), 'utf8');
    for (const [name, src] of [
      ['card', card],
      ['route-start', routeStart],
      ['refill-accept', refill],
    ] as const) {
      assert.match(src, /runRouteLoadAcceptAndRefresh/, `${name} uses shared accept+refresh flow`);
      assert.match(src, /requirePositivePickingId/, `${name} captures exact picking_id`);
      assert.doesNotMatch(
        src,
        /acceptRouteLoad\([^,]+\)\s*;/,
        `${name} must not call acceptRouteLoad with plan_id only`,
      );
    }

    const logistics = readFileSync(resolve(root, 'src/services/gfLogistics.ts'), 'utf8');
    assert.match(logistics, /buildRouteLoadAcceptPayload\(planId, exactPickingId\)/);
    assert.match(logistics, /parseRouteLoadAcceptResponse/);
    assert.match(logistics, /idempotent_replay/);
  });

  it('online-only: no sync queue enqueue for load/refill accept', () => {
    const sources = [
      readFileSync(resolve(root, 'app/route-start.tsx'), 'utf8'),
      readFileSync(resolve(root, 'app/refill-accept.tsx'), 'utf8'),
      readFileSync(resolve(root, 'src/components/domain/RouteLoadAcceptanceCard.tsx'), 'utf8'),
      readFileSync(resolve(root, 'src/services/routeLoadAcceptFlow.ts'), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(sources, /enqueue\(/);
    assert.doesNotMatch(sources, /type:\s*['"]refill['"]/);
    assert.doesNotMatch(sources, /van\.refill\.request/);
  });
});
