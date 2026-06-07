/**
 * Route incident service (Sprint B).
 *
 * IMPORTANT — there is NO dedicated /pwa-ruta/incident-create controller.
 * The PWA Colaboradores fakes that path client-side and actually performs a
 * GENERIC Odoo create on `gf.route.incident` via /api/create_update
 * (see colaboradores-pwa lib/api.js ~L4473). It injects employee_id AND
 * company_id into the dict; the backend does NOT infer them from the token
 * on this generic path.
 *
 * KoldField mirrors that mechanism using its native generic helpers
 * (odooWrite/odooRead → /api/create_update + /get_records), the same way it
 * already does customer_create. Required dict fields (from the PWA):
 *   { name, employee_id, incident_type, severity, requires_follow_up,
 *     active, company_id }
 *
 * ⚠️ BACKEND POLICY DEPENDENCY: this works ONLY if os_api.generic_model_policies
 * allows KoldField's API key to create/read `gf.route.incident`. That cannot be
 * verified from the app repo — Sebas must confirm/enable it before relying on
 * incidents in the field. If the policy denies it, postRpc throws (fix #16) and
 * the screen shows a clear error — no silent/fake success.
 */

import { odooWrite, odooRead } from './odooRpc';
import { logInfo } from '../utils/logger';
import { CreateIncidentPayload, GFIncident } from '../types/incident';

const INCIDENT_MODEL = 'gf.route.incident';

function num(v: unknown): number {
  if (Array.isArray(v)) return num(v[0]);
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  if (Array.isArray(v)) return typeof v[1] === 'string' ? v[1] : String(v[0] ?? '');
  return typeof v === 'string' ? v : '';
}

/**
 * Create an incident via the generic model path (matches the PWA).
 * Throws on functional error (policy denial / validation) — caller shows it.
 */
export async function createIncident(
  payload: CreateIncidentPayload,
  employeeId: number,
  companyId: number,
): Promise<void> {
  await odooWrite(INCIDENT_MODEL, 'create', {
    name: payload.name,
    employee_id: employeeId,
    incident_type: payload.incident_type,
    severity: payload.severity,
    requires_follow_up: true,
    active: true,
    company_id: companyId,
  });
  logInfo('general', 'route_incident_create', {
    incident_type: payload.incident_type,
    severity: payload.severity,
    employee_id: employeeId,
  });
}

/**
 * List the employee's recent incidents (generic read). Best-effort:
 * odooRead returns [] on ACL/availability failure, so the list never blocks
 * the report form. Sorted client-side by create_date desc.
 */
export async function getMyIncidents(employeeId: number): Promise<GFIncident[]> {
  if (!employeeId) return [];
  const rows = await odooRead<Record<string, unknown>>(
    INCIDENT_MODEL,
    [['employee_id', '=', employeeId]],
    ['id', 'name', 'incident_type', 'severity', 'create_date'],
    100,
  );
  return rows
    .map((r) => ({
      id: num(r.id),
      incident_type: str(r.incident_type),
      severity: str(r.severity),
      name: str(r.name),
      created_at: str(r.create_date),
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}
