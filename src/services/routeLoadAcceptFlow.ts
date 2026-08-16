/**
 * R1B-B — Load/Refill accept orchestration (RN-free).
 *
 * Policy:
 * - ONLINE ONLY (no sync queue)
 * - ALWAYS send exact picking_id with plan_id
 * - Success = server ok/success (including idempotent_replay)
 * - Post-success: refresh plan + fresh truck_stock (no local +qty)
 * - Accept success + inventory refresh failure ≠ accept failure
 */

export interface RouteLoadAcceptServerResult {
  ok: boolean;
  idempotent_replay: boolean;
  already_accepted: boolean;
  picking_id: number;
  plan_id: number;
  load_kind?: string;
}

export interface RouteLoadAcceptAndRefreshOutcome {
  accept: RouteLoadAcceptServerResult;
  planRefreshOk: boolean;
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
  return {
    ok: true,
    idempotent_replay: data.idempotent_replay === true || body.idempotent_replay === true,
    already_accepted: data.already_accepted === true || body.already_accepted === true,
    picking_id: Number(data.picking_id || fallback.picking_id) || fallback.picking_id,
    plan_id: Number(data.plan_id || fallback.plan_id) || fallback.plan_id,
    load_kind: typeof data.load_kind === 'string' ? data.load_kind : undefined,
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
    body: `${args.pickingName} quedó confirmada para tu ruta.`,
  };
}

/**
 * Accept then refresh plan + truck_stock. Never invents local +qty.
 * Accept errors throw. Refresh failures are reported in the outcome.
 */
export async function runRouteLoadAcceptAndRefresh(args: {
  planId: number;
  pickingId: number;
  warehouseId?: number | null;
  isOnline: boolean;
  accept: (planId: number, pickingId: number) => Promise<RouteLoadAcceptServerResult>;
  refreshPlan: () => Promise<void>;
  refreshInventory: (warehouseId: number) => Promise<void>;
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
  try {
    await args.refreshPlan();
    planRefreshOk = true;
  } catch {
    planRefreshOk = false;
  }

  let inventoryRefreshOk = true;
  let inventoryRefreshError: string | null = null;
  if (args.warehouseId && Number(args.warehouseId) > 0) {
    try {
      await args.refreshInventory(Number(args.warehouseId));
      inventoryRefreshOk = true;
    } catch (error) {
      inventoryRefreshOk = false;
      inventoryRefreshError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    accept,
    planRefreshOk,
    inventoryRefreshOk,
    inventoryRefreshError: planRefreshOk
      ? inventoryRefreshError
      : (inventoryRefreshError || 'No se pudo refrescar el plan.'),
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
