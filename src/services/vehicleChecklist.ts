/**
 * Vehicle checklist service — Sprint A.
 *
 * Wraps the 6 /pwa-ruta/vehicle-* endpoints already in production (used by
 * the PWA Colaboradores). Online-first: these run at the CEDIS with WiFi
 * before leaving, so we do NOT enqueue them — failures surface to the UI.
 *
 * Contract notes (from PWA api.js, backend QA 32/32 PASS):
 *  - All endpoints return HTTP 200 always; functional errors are in the
 *    envelope as { ok:false, message, code }. postRest already throws on
 *    ok===false, so callers get an Error whose message is the backend's.
 *  - `answered` is the source of truth for "respondido", NOT `passed`.
 */

import { postRest } from './api';
import { logInfo, logWarn } from '../utils/logger';
import {
  GFVehicleChecklist,
  GFVehicleCheck,
  VehicleCheckAnswer,
  ChecklistProgress,
  VehicleChecklistState,
} from '../types/routeStart';
import { getVehicleChecklistBootstrapAction } from './vehicleChecklistLogic';

const PWA_RUTA = 'pwa-ruta';

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function bool(value: unknown): boolean {
  return value === true;
}

/** Unwrap { data: {...} } | {...}. Returns null when empty. */
function unwrap(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const payload = result as Record<string, unknown>;
  const data = payload.data !== undefined ? payload.data : payload;
  if (!data || typeof data !== 'object') return null;
  return data as Record<string, unknown>;
}

function normalizeChecklistHeader(raw: Record<string, unknown>): GFVehicleChecklist {
  return {
    id: num(raw.id),
    route_plan_id: num(raw.route_plan_id),
    state: (str(raw.state) || 'draft') as VehicleChecklistState,
    vehicle_id: raw.vehicle_id != null ? num(raw.vehicle_id) : null,
    vehicle_name: str(raw.vehicle_name),
    checks_total: num(raw.checks_total),
    checks_answered: num(raw.checks_answered),
    checks_passed: num(raw.checks_passed),
    checks_required_pending: num(raw.checks_required_pending),
    notes: str(raw.notes),
  };
}

function normalizeCheck(raw: Record<string, unknown>): GFVehicleCheck {
  return {
    id: num(raw.id),
    sequence: num(raw.sequence),
    name: str(raw.name),
    check_type: (str(raw.check_type) || 'yes_no') as GFVehicleCheck['check_type'],
    required: bool(raw.required),
    blocking_on_fail: bool(raw.blocking_on_fail),
    passed: bool(raw.passed),
    answered: bool(raw.answered),
    not_passed_reason: str(raw.not_passed_reason),
    expected_bool: raw.expected_bool != null ? bool(raw.expected_bool) : undefined,
    min_value: raw.min_value != null ? num(raw.min_value) : null,
    max_value: raw.max_value != null ? num(raw.max_value) : null,
    result_bool: raw.result_bool != null ? bool(raw.result_bool) : null,
    result_numeric: raw.result_numeric != null ? num(raw.result_numeric) : null,
    result_text: str(raw.result_text),
    result_photo_url: raw.result_photo_url != null ? str(raw.result_photo_url) : null,
  };
}

/**
 * Read checklist header for a plan. Returns null when none exists yet
 * (backend responds { ok:true, data:null }).
 *
 * These endpoints are Odoo type=json routes; use POST payloads even for reads.
 */
export async function getVehicleChecklist(
  routePlanId: number,
): Promise<GFVehicleChecklist | null> {
  const result = await postRest<unknown>(`${PWA_RUTA}/vehicle-checklist`, {
    route_plan_id: routePlanId,
  });
  const data = unwrap(result);
  if (!data) return null;
  return normalizeChecklistHeader(data);
}

/** POST create checklist (idempotent). Returns checklist_id. */
export async function createVehicleChecklist(routePlanId: number): Promise<number> {
  const result = await postRest<unknown>(`${PWA_RUTA}/vehicle-checklist-create`, {
    route_plan_id: routePlanId,
  });
  const data = unwrap(result);
  const id = num(data?.checklist_id);
  logInfo('general', 'route_checklist_create', { routePlanId, id });
  return id;
}

/** POST init checklist: instantiates checks (draft → in_progress). */
export async function initVehicleChecklist(checklistId: number): Promise<void> {
  await postRest<unknown>(`${PWA_RUTA}/vehicle-checklist-init`, {
    checklist_id: checklistId,
  });
  logInfo('general', 'route_checklist_init', { checklistId });
}

/** Read all checks for a checklist. */
export async function getVehicleChecks(checklistId: number): Promise<GFVehicleCheck[]> {
  const result = await postRest<unknown>(`${PWA_RUTA}/vehicle-checks`, {
    checklist_id: checklistId,
  });
  const data = unwrap(result);
  const checks = Array.isArray(data?.checks) ? data!.checks : [];
  return (checks as unknown[])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map(normalizeCheck)
    .sort((a, b) => a.sequence - b.sequence);
}

/** POST a single answer. Backend computes `passed`. Idempotent (overwrites). */
export async function submitVehicleCheck(
  checkId: number,
  answer: VehicleCheckAnswer,
): Promise<ChecklistProgress | null> {
  const result = await postRest<unknown>(`${PWA_RUTA}/vehicle-check`, {
    check_id: checkId,
    ...answer,
  });
  const data = unwrap(result);
  const progress = data?.checklist_progress;
  if (progress && typeof progress === 'object') {
    const p = progress as Record<string, unknown>;
    return {
      answered: num(p.answered),
      total: num(p.total),
      passed: num(p.passed),
      requiredPending: num(p.required_pending),
    };
  }
  return null;
}

/**
 * POST complete checklist. Backend validates required answered + no blocking
 * fail. Throws on functional error — caller inspects message/code.
 */
export async function completeVehicleChecklist(
  checklistId: number,
  notes = '',
): Promise<void> {
  try {
    await postRest<unknown>(`${PWA_RUTA}/vehicle-checklist-complete`, {
      checklist_id: checklistId,
      notes: notes.trim(),
    });
    logInfo('general', 'route_checklist_complete', { checklistId });
  } catch (err) {
    // already_completed is terminal-friendly — treat as success.
    const msg = err instanceof Error ? err.message : '';
    if (/already.?completed|ya.*complet/i.test(msg)) {
      logWarn('general', 'route_checklist_already_completed', { checklistId });
      return;
    }
    throw err;
  }
}

/**
 * Convenience orchestrator used by the screen: ensure a checklist exists and
 * is initialized, returning the header + checks in one call.
 *
 * Mirrors the PWA ScreenChecklistUnidad bootstrap sequence:
 *   getVehicleChecklist → (null) create+init → (draft) init → getVehicleChecks
 */
export async function ensureChecklistReady(routePlanId: number): Promise<{
  header: GFVehicleChecklist;
  checks: GFVehicleCheck[];
}> {
  let header = await getVehicleChecklist(routePlanId);
  let action = getVehicleChecklistBootstrapAction(header);

  if (action === 'create') {
    const checklistId = await createVehicleChecklist(routePlanId);
    if (checklistId > 0) {
      await initVehicleChecklist(checklistId);
    }
    header = await getVehicleChecklist(routePlanId);
    action = getVehicleChecklistBootstrapAction(header);
  }

  if (action === 'init' && header) {
    await initVehicleChecklist(header.id);
    header = await getVehicleChecklist(routePlanId);
  }

  if (!header) {
    throw new Error('No se pudo preparar el checklist de unidad.');
  }

  const checks = header.id > 0 ? await getVehicleChecks(header.id) : [];
  return { header, checks };
}
