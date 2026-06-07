/**
 * Pure helpers + catalogs for the route incident flow (Sprint B).
 * No network, no RN — fully unit-testable.
 *
 * Categories/severities mirror the production gf.route.incident enum
 * (ES label → EN backend value), the same mapping the PWA uses.
 */

import type {
  IncidentCategory,
  IncidentSeverityOption,
  IncidentTypeBackend,
  IncidentSeverityBackend,
  CreateIncidentPayload,
} from '../types/incident';

export const INCIDENT_CATEGORIES: IncidentCategory[] = [
  { key: 'operacion', label: 'Operación', backend: 'operation' },
  { key: 'cliente', label: 'Cliente', backend: 'customer' },
  { key: 'calidad', label: 'Calidad', backend: 'quality' },
  { key: 'cobranza', label: 'Cobranza', backend: 'collection' },
  { key: 'vehiculo', label: 'Vehículo', backend: 'vehicle' },
];

export const INCIDENT_SEVERITIES: IncidentSeverityOption[] = [
  { key: 'baja', label: 'Baja', backend: 'low' },
  { key: 'media', label: 'Media', backend: 'medium' },
  { key: 'alta', label: 'Alta', backend: 'high' },
];

const TYPE_BY_KEY = new Map(INCIDENT_CATEGORIES.map((c) => [c.key, c.backend]));
const SEV_BY_KEY = new Map(INCIDENT_SEVERITIES.map((s) => [s.key, s.backend]));

/** Map an ES category key → backend enum, or null if unknown. */
export function toBackendIncidentType(key: string | null | undefined): IncidentTypeBackend | null {
  if (!key) return null;
  return TYPE_BY_KEY.get(key) ?? null;
}

/** Map an ES severity key → backend enum, or null if unknown. */
export function toBackendSeverity(key: string | null | undefined): IncidentSeverityBackend | null {
  if (!key) return null;
  return SEV_BY_KEY.get(key) ?? null;
}

/** Human label for a backend incident_type (for the "recent" list). */
export function labelForIncidentType(backend: string): string {
  const match = INCIDENT_CATEGORIES.find((c) => c.backend === backend);
  return match?.label ?? backend;
}

export function labelForSeverity(backend: string): string {
  const match = INCIDENT_SEVERITIES.find((s) => s.backend === backend);
  return match?.label ?? backend;
}

export interface IncidentFormInput {
  typeKey: string | null;
  severityKey: string | null;
  description: string;
}

export type IncidentValidation =
  | { ok: true; payload: CreateIncidentPayload }
  | { ok: false; reason: string };

/**
 * Validate + build the create-incident payload. Returns a discriminated
 * union so the screen can show a precise message without re-deriving rules.
 */
export function buildIncidentPayload(input: IncidentFormInput): IncidentValidation {
  const type = toBackendIncidentType(input.typeKey);
  if (!type) return { ok: false, reason: 'Selecciona el tipo de incidente.' };
  const severity = toBackendSeverity(input.severityKey);
  if (!severity) return { ok: false, reason: 'Selecciona la severidad.' };
  const name = (input.description || '').trim();
  if (!name) return { ok: false, reason: 'Describe brevemente el incidente.' };
  if (name.length < 3) return { ok: false, reason: 'La descripción es muy corta.' };
  return { ok: true, payload: { incident_type: type, severity, name } };
}
