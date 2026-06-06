/**
 * Route incident service (Sprint B).
 *
 * Wraps /pwa-ruta/incident-create + /pwa-ruta/my-incidents. These endpoints
 * are NOT in the gf_logistics_ops snapshot (older than the deployed backend)
 * but are production-proven by the PWA Colaboradores. Online-first; postRest
 * throws on functional error so the UI shows the backend message honestly.
 *
 * The controller derives employee/company from the token; we send only the
 * core fields (incident_type, severity, name). Plan/stop association is NOT
 * in the current contract — see SPRINT-B notes.
 */

import { postRest, getRest } from './api';
import { logInfo } from '../utils/logger';
import { CreateIncidentPayload, GFIncident } from '../types/incident';

const PWA_RUTA = 'pwa-ruta';

function unwrap(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const payload = result as Record<string, unknown>;
  const data = payload.data !== undefined ? payload.data : payload;
  if (!data || typeof data !== 'object') return null;
  return data as Record<string, unknown>;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Create an incident. Throws on functional error (message from backend). */
export async function createIncident(payload: CreateIncidentPayload): Promise<void> {
  await postRest<unknown>(`${PWA_RUTA}/incident-create`, {
    incident_type: payload.incident_type,
    severity: payload.severity,
    name: payload.name,
  });
  logInfo('general', 'route_incident_create', {
    incident_type: payload.incident_type,
    severity: payload.severity,
  });
}

/** List the employee's recent incidents. Returns [] on shape mismatch. */
export async function getMyIncidents(employeeId: number): Promise<GFIncident[]> {
  const result = await getRest<unknown>(`${PWA_RUTA}/my-incidents?employee_id=${employeeId}`);
  const data = unwrap(result);
  const rows = Array.isArray(data?.incidents)
    ? data!.incidents
    : Array.isArray(data)
      ? (data as unknown[])
      : [];
  return (rows as unknown[])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      id: num(r.id),
      incident_type: str(r.incident_type),
      severity: str(r.severity),
      name: str(r.name) || str(r.description),
      created_at: str(r.created_at) || str(r.create_date),
    }));
}
