/**
 * R1B-B — Load/Refill accept orchestration (RN-free).
 *
 * Policy:
 * - ONLINE ONLY (no sync queue)
 * - ALWAYS send exact picking_id with plan_id
 * - Success = server ok/success (including idempotent_replay)
 * - Post-success: refresh plan + fresh truck_stock (no local +qty)
 * - Accept success + inventory refresh failure ≠ accept failure
 * - Refresh success requires EXPLICIT evidence (not Promise resolved / no-throw)
 */

export interface RouteLoadAcceptServerResult {
  ok: boolean;
  idempotent_replay: boolean;
  already_accepted: boolean;
  picking_id: number;
  plan_id: number;
  load_kind?: string;
}

/** Explicit plan refresh evidence — do not infer from Promise resolve. */
export interface PlanRefreshEvidence {
  ok: boolean;
  reason?: string;
}

/**
 * Explicit inventory refresh evidence.
 * Authoritative success requires truck_stock for the expected warehouse.
 */
export interface InventoryRefreshEvidence {
  ok: boolean;
  authoritative: boolean;
  reason?: string;
  warehouseId?: number;
  source?: string;
}

export interface RouteLoadAcceptAndRefreshOutcome {
  accept: RouteLoadAcceptServerResult;
  planRefreshOk: boolean;
  planRefreshReason: string | null;
  inventoryRefreshOk: boolean;
  inventoryRefreshError: string | null;
}

export function requirePositivePickingId(pickingId: unknown): number {
  const id = typeof pickingId === 'number' ? pickingId : Number(pickingId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('picking_id es obligatorio para aceptar carga/recarga.');
  }
  return Math.trunc(id);
}

export function requirePositivePlanId(planId: unknown): number {
  const id = typeof planId === 'number' ? planId : Number(planId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('plan_id es obligatorio para aceptar carga/recarga.');
  }
  return Math.trunc(id);
}

function readPositiveId(value: unknown): number | null {
  if (value == null || value === false || value === '') return null;
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.trunc(id);
}

/** Normalize seal_load HTTP body into a typed accept result. */
export function parseRouteLoadAcceptResponse(
  raw: unknown,
  fallback: { plan_id: number; picking_id: number },
): RouteLoadAcceptServerResult {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const data = body.data && typeof body.data === 'object'
    ? (body.data as Record<string, unknown>)
    : {};
  const ok = body.ok === true || body.success === true;
  if (!ok) {
    const message = typeof body.message === 'string' && body.message.trim()
      ? body.message
      : 'No se pudo aceptar la carga.';
    throw new Error(message);
  }

  // Fail-closed when server returns explicit IDs that disagree with the request.
  // Omitted fields fall back to the requested identity (backend #92 always echoes both).
  const responsePlanId = readPositiveId(data.plan_id);
  const responsePickingId = readPositiveId(data.picking_id);
  if (responsePlanId != null && responsePlanId !== fallback.plan_id) {
    throw new Error('Respuesta de aceptación con plan_id inconsistente.');
  }
  if (responsePickingId != null && responsePickingId !== fallback.picking_id) {
    throw new Error('Respuesta de aceptación con picking_id inconsistente.');
  }

  return {
    ok: true,
    idempotent_replay: data.idempotent_replay === true || body.idempotent_replay === true,
    already_accepted: data.already_accepted === true || body.already_accepted === true,
    picking_id: responsePickingId ?? fallback.picking_id,
    plan_id: responsePlanId ?? fallback.plan_id,
    load_kind: typeof data.load_kind === 'string' ? data.load_kind : undefined,
  };
}

/**
 * Evaluate RouteStore snapshot AFTER loadPlan({ force: true }).
 * Success requires matching plan_id and routeFreshness === 'updated'.
 */
export function evaluatePlanRefreshEvidence(args: {
  expectedPlanId: number;
  plan: { plan_id?: number | null } | null | undefined;
  routeFreshness: string;
}): PlanRefreshEvidence {
  const expected = requirePositivePlanId(args.expectedPlanId);
  if (!args.plan || args.plan.plan_id == null) {
    return { ok: false, reason: 'missing_plan' };
  }
  const currentId = Number(args.plan.plan_id);
  if (!Number.isFinite(currentId) || currentId !== expected) {
    return { ok: false, reason: 'plan_mismatch' };
  }
  if (args.routeFreshness !== 'updated') {
    return {
      ok: false,
      reason: args.routeFreshness === 'stale'
        ? 'stale'
        : (args.routeFreshness || 'not_updated'),
    };
  }
  return { ok: true };
}

/**
 * Inventory refresh is SUCCESS only for authoritative truck_stock of the
 * expected warehouse. Promise resolve alone is never enough.
 */
export function evaluateInventoryRefreshEvidence(
  result: {
    ok: boolean;
    authoritative: boolean;
    warehouseId?: number;
    source?: string;
    reason?: string;
  },
  expectedWarehouseId: number,
): InventoryRefreshEvidence {
  const expected = Number(expectedWarehouseId);
  if (
    result.ok === true
    && result.authoritative === true
    && Number(result.warehouseId) === expected
    && result.source === 'truck_stock'
  ) {
    return {
      ok: true,
      authoritative: true,
      warehouseId: expected,
      source: 'truck_stock',
    };
  }
  let reason = result.reason || 'unknown';
  if (!result.reason && result.source && result.source !== 'truck_stock') {
    reason = 'not_truck_stock';
  }
  if (!result.reason && result.warehouseId != null && Number(result.warehouseId) !== expected) {
    reason = 'warehouse_mismatch';
  }
  return {
    ok: false,
    authoritative: false,
    reason,
    warehouseId: result.warehouseId,
    source: result.source,
  };
}

export function describeRouteLoadAcceptSuccess(args: {
  isRefill: boolean;
  pickingName: string;
  idempotentReplay: boolean;
  inventoryRefreshOk: boolean;
}): { title: string; body: string } {
  const title = args.isRefill ? 'Recarga aceptada' : 'Carga aceptada';
  if (!args.inventoryRefreshOk) {
    return {
      title,
      body:
        `${args.pickingName} quedó confirmada en servidor, pero no se pudo actualizar `
        + 'el inventario todavía. Reintenta refrescar productos cuando tengas señal.',
    };
  }
  if (args.idempotentReplay) {
    return {
      title,
      body: `${args.pickingName} ya estaba confirmada. Inventario actualizado.`,
    };
  }
  return {
    title,
    body: `${args.pickingName} quedó confirmada para tu ruta. Inventario actualizado.`,
  };
}

/**
 * Accept then refresh plan + truck_stock. Never invents local +qty.
 * Accept errors throw. Refresh failures are reported in the outcome via
 * structured evidence (not throw/no-throw alone).
 */
export async function runRouteLoadAcceptAndRefresh(args: {
  planId: number;
  pickingId: number;
  warehouseId?: number | null;
  isOnline: boolean;
  accept: (planId: number, pickingId: number) => Promise<RouteLoadAcceptServerResult>;
  refreshPlan: () => Promise<PlanRefreshEvidence>;
  refreshInventory: (warehouseId: number) => Promise<InventoryRefreshEvidence>;
  offlineMessage?: string;
}): Promise<RouteLoadAcceptAndRefreshOutcome> {
  const planId = requirePositivePlanId(args.planId);
  const pickingId = requirePositivePickingId(args.pickingId);
  if (!args.isOnline) {
    throw new Error(
      args.offlineMessage
        || 'Sin conexión. Conéctate para aceptar la carga/recarga.',
    );
  }

  const accept = await args.accept(planId, pickingId);

  let planRefreshOk = false;
  let planRefreshReason: string | null = null;
  try {
    const planEvidence = await args.refreshPlan();
    planRefreshOk = planEvidence.ok === true;
    planRefreshReason = planRefreshOk ? null : (planEvidence.reason || 'plan_refresh_failed');
  } catch (error) {
    planRefreshOk = false;
    planRefreshReason = error instanceof Error ? error.message : 'plan_refresh_threw';
  }

  let inventoryRefreshOk = false;
  let inventoryRefreshError: string | null = null;
  const warehouseId = args.warehouseId != null ? Number(args.warehouseId) : NaN;
  if (!Number.isFinite(warehouseId) || warehouseId <= 0) {
    inventoryRefreshOk = false;
    inventoryRefreshError = 'missing_warehouse';
  } else {
    try {
      const invEvidence = await args.refreshInventory(warehouseId);
      const evaluated = evaluateInventoryRefreshEvidence(invEvidence, warehouseId);
      inventoryRefreshOk = evaluated.ok === true && evaluated.authoritative === true;
      inventoryRefreshError = inventoryRefreshOk
        ? null
        : (evaluated.reason || 'inventory_refresh_failed');
    } catch (error) {
      inventoryRefreshOk = false;
      inventoryRefreshError = error instanceof Error ? error.message : 'inventory_refresh_threw';
    }
  }

  return {
    accept,
    planRefreshOk,
    planRefreshReason,
    inventoryRefreshOk,
    inventoryRefreshError: planRefreshOk
      ? inventoryRefreshError
      : (inventoryRefreshError || planRefreshReason || 'No se pudo refrescar el plan.'),
  };
}

/** Single-flight gate keyed by picking id (pure helper for UI/services). */
export function createPickingAcceptFlightGate() {
  let inFlightPickingId: number | null = null;
  return {
    tryBegin(pickingId: number): boolean {
      const id = requirePositivePickingId(pickingId);
      if (inFlightPickingId != null) return false;
      inFlightPickingId = id;
      return true;
    },
    end(pickingId: number): void {
      if (inFlightPickingId === pickingId) inFlightPickingId = null;
    },
    get inFlightPickingId() {
      return inFlightPickingId;
    },
  };
}
