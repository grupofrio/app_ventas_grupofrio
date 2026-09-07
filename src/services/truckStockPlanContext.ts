export type TruckStockPlanRequest =
  | { ok: true; body: { plan_id: number } }
  | { ok: false; reason: 'plan_unavailable' };

/** Build the only allowed truck-stock request context: an active route plan. */
export function buildTruckStockPlanRequest(planId: number | null | undefined): TruckStockPlanRequest {
  if (!Number.isInteger(planId) || Number(planId) <= 0) {
    return { ok: false, reason: 'plan_unavailable' };
  }
  return { ok: true, body: { plan_id: Number(planId) } };
}
