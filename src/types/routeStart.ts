/**
 * Types for the Sprint A "Iniciar operación" flow (checklist de unidad,
 * aceptar carga, KM inicial). Contracts ported from the PWA Colaboradores
 * `ruta` module (api.js) which has driven these endpoints in production.
 *
 * All these endpoints return HTTP 200 always — functional errors come back
 * as { ok:false, message, code } inside the envelope. postRest/unwrapRestResult
 * already throw on ok===false, so service wrappers translate `code` into
 * friendly messages.
 */

// ── Vehicle checklist ────────────────────────────────────────────────────────

export type VehicleChecklistState =
  | 'draft'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface GFVehicleChecklist {
  id: number;
  route_plan_id: number;
  state: VehicleChecklistState;
  vehicle_id: number | null;
  vehicle_name: string;
  checks_total: number;
  checks_answered: number;
  checks_passed: number;
  checks_required_pending: number;
  notes: string;
}

export type VehicleCheckType = 'yes_no' | 'numeric' | 'text' | 'photo';

export interface GFVehicleCheck {
  id: number;
  sequence: number;
  name: string;
  check_type: VehicleCheckType;
  required: boolean;
  blocking_on_fail: boolean;
  passed: boolean;
  answered: boolean;
  not_passed_reason: string;
  // type-specific
  expected_bool?: boolean;
  min_value?: number | null;
  max_value?: number | null;
  result_bool?: boolean | null;
  result_numeric?: number | null;
  result_text?: string;
  result_photo_url?: string | null;
}

/** Payload to submit a single check answer. Backend computes `passed`. */
export type VehicleCheckAnswer =
  | { result_bool: boolean; not_passed_reason?: string }
  | { result_numeric: number }
  | { result_text: string }
  | { result_photo: string; result_photo_filename?: string };

export interface ChecklistProgress {
  answered: number;
  total: number;
  passed: number;
  requiredPending: number;
}

// NOTE: Load cards/lines reuse the existing RouteLoadCard / RouteLoadLine
// types from src/services/routeLoadAcceptance.ts (shipped by Sebas).
// Sprint A does not redefine them.

// ── KM ───────────────────────────────────────────────────────────────────────

export type KmType = 'departure' | 'arrival';

export interface GFKmResult {
  ok: boolean;
  plan_id: number | null;
  type: KmType | null;
  km: number | null;
  /** Stored values echoed by the backend (Sprint C.1). */
  departure_km?: number | null;
  arrival_km?: number | null;
}

// ── Readiness (Sprint A hub) ─────────────────────────────────────────────────

export interface RouteStartReadiness {
  checklistDone: boolean;
  kmCaptured: boolean;
  loadAccepted: boolean;
  /** true only when all three prerequisites are satisfied. */
  readyToStart: boolean;
}
