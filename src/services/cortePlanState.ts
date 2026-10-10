/**
 * Corte de unidades is confirmed when the plan says so. Odoo may send the
 * flag as a boolean or as 1 / "True". A refresh that omits the field must
 * not wipe a confirmation we already stored for the same plan.
 */

import type { GFPlan } from '../types/plan';

export function isCorteValidatedFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

export function mergePlanCorteValidated(
  cached: Pick<GFPlan, 'plan_id' | 'corte_validated'> | null | undefined,
  next: GFPlan,
): GFPlan {
  if (isCorteValidatedFlag(next.corte_validated)) {
    return next.corte_validated === true ? next : { ...next, corte_validated: true };
  }
  if (
    cached
    && cached.plan_id === next.plan_id
    && isCorteValidatedFlag(cached.corte_validated)
    && next.corte_validated == null
  ) {
    return { ...next, corte_validated: true };
  }
  return next;
}
