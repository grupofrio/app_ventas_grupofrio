/**
 * R1B-B load/refill accept flow — behavioral + contract tests.
 *
 * Refresh success requires EXPLICIT evidence (not Promise resolve / no-throw).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  createPickingAcceptFlightGate,
  describeRouteLoadAcceptSuccess,
  evaluateInventoryRefreshEvidence,
  evaluatePlanRefreshEvidence,
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

const okAccept = (planId: number, pickingId: number, extra: Record<string, unknown> = {}) => ({
  ok: true as const,
  idempotent_replay: false,
  already_accepted: false,
  plan_id: planId,
  picking_id: pickingId,
  ...extra,
});

const okPlan = async () => ({ ok: true as const });
const okInventory = async (warehouseId = 137) => ({
  ok: true as const,
  authoritative: true as const,
  warehouseId,
  source: 'truck_stock' as const,
});

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

  it('fail-closed on explicit plan/picking identity mismatch', () => {
    assert.throws(
      () => parseRouteLoadAcceptResponse(
        { ok: true, data: { plan_id: 99, picking_id: 55 } },
        { plan_id: 10, picking_id: 55 },
      ),
      /plan_id inconsistente/,
    );
    assert.throws(
      () => parseRouteLoadAcceptResponse(
        { ok: true, data: { plan_id: 10, picking_id: 77 } },
        { plan_id: 10, picking_id: 55 },
      ),
      /picking_id inconsistente/,
    );
  });
});

describe('R1B-B refresh evidence helpers', () => {
  it('plan: updated + matching plan_id → ok', () => {
    assert.deepEqual(
      evaluatePlanRefreshEvidence({
        expectedPlanId: 10,
        plan: { plan_id: 10 },
        routeFreshness: 'updated',
      }),
      { ok: true },
    );
  });

  it('plan: stale / mismatch → not ok (Promise resolve alone is insufficient)', () => {
    assert.equal(
      evaluatePlanRefreshEvidence({
        expectedPlanId: 10,
        plan: { plan_id: 10 },
        routeFreshness: 'stale',
      }).reason,
      'stale',
    );
    assert.equal(
      evaluatePlanRefreshEvidence({
        expectedPlanId: 10,
        plan: { plan_id: 11 },
        routeFreshness: 'updated',
      }).ok,
      false,
    );
  });

  it('inventory: only authoritative truck_stock response is accepted', () => {
    assert.equal(
      evaluateInventoryRefreshEvidence(
        { ok: true, authoritative: true, warehouseId: 7, source: 'truck_stock' },
      ).ok,
      true,
    );
    assert.equal(
      evaluateInventoryRefreshEvidence(
        { ok: false, authoritative: false, reason: 'network_error' },
      ).ok,
      false,
    );
    assert.equal(
      evaluateInventoryRefreshEvidence(
        { ok: true, authoritative: true, warehouseId: 7, source: 'stock_quant' },
      ).ok,
      false,
    );
  });
});

describe('R1B-B runRouteLoadAcceptAndRefresh', () => {
  it('A: happy authoritative refresh', async () => {
    const calls: string[] = [];
    const outcome = await runRouteLoadAcceptAndRefresh({
      planId: 100,
      pickingId: 200,
      warehouseId: 7,
      isOnline: true,
      accept: async (planId, pickingId) => {
        calls.push(`accept:${planId}:${pickingId}`);
        return okAccept(planId, pickingId);
      },
      refreshPlan: async () => {
        calls.push('plan');
        return { ok: true };
      },
      refreshInventory: async () => {
        calls.push('inv');
        return {
          ok: true,
          authoritative: true,
          warehouseId: 137,
          source: 'truck_stock',
        };
      },
    });
    assert.deepEqual(calls, ['accept:100:200', 'plan', 'inv']);
    assert.equal(outcome.accept.ok, true);
    assert.equal(outcome.planRefreshOk, true);
    assert.equal(outcome.inventoryRefreshOk, true);
    const copy = describeRouteLoadAcceptSuccess({
      isRefill: false,
      pickingName: 'WH/OUT/1',
      idempotentReplay: false,
      inventoryRefreshOk: true,
    });
    assert.match(copy.body, /Inventario actualizado/i);
  });

  it('B: inventory result false WITHOUT THROW → inventoryRefreshOk false', async () => {
    let invCalls = 0;
    const outcome = await runRouteLoadAcceptAndRefresh({
      planId: 5,
      pickingId: 6,
      warehouseId: 9,
      isOnline: true,
      accept: async () => okAccept(5, 6),
      refreshPlan: okPlan,
      refreshInventory: async () => {
        invCalls += 1;
        return {
          ok: false,
          authoritative: false,
          reason: 'network_error',
        };
      },
    });
    assert.equal(invCalls, 1);
    assert.equal(outcome.accept.ok, true);
    assert.equal(outcome.planRefreshOk, true);
    assert.equal(outcome.inventoryRefreshOk, false);
    assert.equal(outcome.inventoryRefreshError, 'network_error');
    const copy = describeRouteLoadAcceptSuccess({
      isRefill: true,
      pickingName: 'REFILL/2',
      idempotentReplay: false,
      inventoryRefreshOk: false,
    });
    assert.equal(copy.title, 'Recarga aceptada');
    assert.match(copy.body, /no se pudo actualizar el inventario/i);
    assert.doesNotMatch(copy.body, /Inventario actualizado/i);
  });

  it('C: plan result false WITHOUT THROW → planRefreshOk false; accept stays success', async () => {
    const outcome = await runRouteLoadAcceptAndRefresh({
      planId: 10,
      pickingId: 11,
      warehouseId: 3,
      isOnline: true,
      accept: async () => okAccept(10, 11),
      refreshPlan: async () => ({ ok: false, reason: 'stale' }),
      refreshInventory: okInventory,
    });
    assert.equal(outcome.accept.ok, true);
    assert.equal(outcome.planRefreshOk, false);
    assert.equal(outcome.planRefreshReason, 'stale');
    assert.equal(outcome.inventoryRefreshOk, true);
    const copy = describeRouteLoadAcceptSuccess({
      isRefill: false,
      pickingName: 'WH/OUT/9',
      idempotentReplay: false,
      inventoryRefreshOk: outcome.inventoryRefreshOk && outcome.planRefreshOk,
    });
    assert.match(copy.body, /no se pudo actualizar el inventario/i);
  });

  it('D: missing employee warehouse still refreshes stock from the active plan', async () => {
    let invCalls = 0;
    const outcome = await runRouteLoadAcceptAndRefresh({
      planId: 1,
      pickingId: 2,
      warehouseId: null,
      isOnline: true,
      accept: async () => okAccept(1, 2),
      refreshPlan: okPlan,
      refreshInventory: async () => {
        invCalls += 1;
        return okInventory(99);
      },
    });
    assert.equal(invCalls, 1);
    assert.equal(outcome.accept.ok, true);
    assert.equal(outcome.inventoryRefreshOk, true);
    assert.equal(outcome.inventoryRefreshError, null);
  });

  it('E: accept success + both refresh fail → accept stays success', async () => {
    const outcome = await runRouteLoadAcceptAndRefresh({
      planId: 8,
      pickingId: 9,
      warehouseId: 4,
      isOnline: true,
      accept: async () => okAccept(8, 9),
      refreshPlan: async () => ({ ok: false, reason: 'stale' }),
      refreshInventory: async () => ({
        ok: false,
        authoritative: false,
        reason: 'network_error',
      }),
    });
    assert.equal(outcome.accept.ok, true);
    assert.equal(outcome.planRefreshOk, false);
    assert.equal(outcome.inventoryRefreshOk, false);
  });

  it('F: idempotent replay + authoritative refresh', async () => {
    const outcome = await runRouteLoadAcceptAndRefresh({
      planId: 1,
      pickingId: 99,
      warehouseId: 3,
      isOnline: true,
      accept: async (planId, pickingId) => ({
        ...okAccept(planId, pickingId),
        idempotent_replay: true,
        already_accepted: true,
        load_kind: 'initial',
      }),
      refreshPlan: okPlan,
      refreshInventory: okInventory,
    });
    assert.equal(outcome.accept.idempotent_replay, true);
    assert.equal(outcome.inventoryRefreshOk, true);
    assert.equal(outcome.planRefreshOk, true);
    const copy = describeRouteLoadAcceptSuccess({
      isRefill: false,
      pickingName: 'WH/OUT/1',
      idempotentReplay: true,
      inventoryRefreshOk: true,
    });
    assert.match(copy.body, /ya estaba confirmada/i);
    assert.match(copy.body, /Inventario actualizado/i);
  });

  it('lost-response retry uses SAME picking_id', async () => {
    const sent: Array<{ planId: number; pickingId: number }> = [];
    let attempt = 0;
    const accept = async (planId: number, pickingId: number) => {
      sent.push({ planId, pickingId });
      attempt += 1;
      if (attempt === 1) throw new Error('network timeout');
      return {
        ...okAccept(planId, pickingId),
        idempotent_replay: true,
        already_accepted: true,
      };
    };

    await assert.rejects(
      () => runRouteLoadAcceptAndRefresh({
        planId: 1,
        pickingId: 99,
        warehouseId: 3,
        isOnline: true,
        accept,
        refreshPlan: okPlan,
        refreshInventory: okInventory,
      }),
      /network timeout/,
    );

    const replay = await runRouteLoadAcceptAndRefresh({
      planId: 1,
      pickingId: 99,
      warehouseId: 3,
      isOnline: true,
      accept,
      refreshPlan: okPlan,
      refreshInventory: okInventory,
    });
    assert.deepEqual(sent, [
      { planId: 1, pickingId: 99 },
      { planId: 1, pickingId: 99 },
    ]);
    assert.equal(replay.accept.idempotent_replay, true);
    assert.equal(replay.inventoryRefreshOk, true);
  });

  it('throwing inventory still treated as refresh fail (compat)', async () => {
    const outcome = await runRouteLoadAcceptAndRefresh({
      planId: 5,
      pickingId: 6,
      warehouseId: 9,
      isOnline: true,
      accept: async () => okAccept(5, 6),
      refreshPlan: okPlan,
      refreshInventory: async () => {
        throw new Error('truck_stock down');
      },
    });
    assert.equal(outcome.accept.ok, true);
    assert.equal(outcome.inventoryRefreshOk, false);
    assert.match(outcome.inventoryRefreshError || '', /truck_stock/);
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
          return okAccept(1, 2);
        },
        refreshPlan: okPlan,
        refreshInventory: okInventory,
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
  it('H: pending cards retain independent picking_ids; payload always includes picking_id', () => {
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
  it('G: refill +20 via snapshot → 70; pending sale -5 → 65; never 90', async () => {
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
  it('accept paths use authoritative inventory + plan evidence', () => {
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
      assert.match(src, /loadProductsAuthoritative/, `${name} uses authoritative inventory loader`);
      assert.match(src, /evaluatePlanRefreshEvidence/, `${name} evaluates plan freshness evidence`);
      assert.match(src, /evaluateInventoryRefreshEvidence/, `${name} evaluates inventory evidence`);
      assert.doesNotMatch(
        src,
        /acceptRouteLoad\([^,]+\)\s*;/,
        `${name} must not call acceptRouteLoad with plan_id only`,
      );
    }

    // Card must not treat void loadProducts as refresh success evidence.
    assert.doesNotMatch(card, /loadProducts=\{loadProducts\}/);
    assert.match(card, /loadProductsAuthoritative/);

    const logistics = readFileSync(resolve(root, 'src/services/gfLogistics.ts'), 'utf8');
    assert.match(logistics, /buildRouteLoadAcceptPayload\(planId, exactPickingId\)/);
    assert.match(logistics, /parseRouteLoadAcceptResponse/);
    assert.match(logistics, /idempotent_replay/);

    const flow = readFileSync(resolve(root, 'src/services/routeLoadAcceptFlow.ts'), 'utf8');
    assert.doesNotMatch(flow, /missing_warehouse/);
    assert.match(flow, /source === 'truck_stock'/);
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
