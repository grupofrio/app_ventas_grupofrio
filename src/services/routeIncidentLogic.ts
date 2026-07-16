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

export type EmployeeIncidentCreateRequest = {
  operation_id: string;
  plan_id: number;
  incident_type: string;
  severity: string;
  note: string;
};

type EmployeeIncidentCreateResult = {
  id: number;
  operation_id?: string;
} | null;

export type IncidentSubmissionService = {
  submit: (input: {
    planId: number;
    payload: CreateIncidentPayload;
  }) => Promise<{ id: number }>;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function incidentDraftKey(planId: number, payload: CreateIncidentPayload): string {
  return JSON.stringify([planId, payload.incident_type, payload.severity, payload.name.trim()]);
}

/**
 * Conserva el operation_id en memoria para un mismo borrador de reporte hasta
 * que el servidor confirme una incidencia válida. Si se pierde la respuesta
 * después de crearla, el retry reutiliza exactamente el mismo id; después de
 * confirmar, el siguiente envío recibe un id nuevo.
 */
export function createIncidentSubmissionService(input: {
  createEmployeeIncident: (payload: EmployeeIncidentCreateRequest) => Promise<EmployeeIncidentCreateResult>;
  createOperationId: () => string;
}): IncidentSubmissionService {
  const pendingOperationIds = new Map<string, string>();

  return {
    async submit({ planId, payload }) {
      if (!isPositiveInteger(planId)) {
        throw new Error('No hay una ruta activa para registrar la incidencia.');
      }
      const key = incidentDraftKey(planId, payload);
      let operationId = pendingOperationIds.get(key);
      if (!operationId) {
        operationId = input.createOperationId().trim();
        if (!operationId) {
          throw new Error('No se pudo preparar el identificador de la incidencia.');
        }
        pendingOperationIds.set(key, operationId);
      }

      const result = await input.createEmployeeIncident({
        operation_id: operationId,
        plan_id: planId,
        incident_type: payload.incident_type,
        severity: payload.severity,
        note: payload.name,
      });
      if (!result || !isPositiveInteger(result.id)) {
        throw new Error('El servidor no confirmó la incidencia.');
      }
      if (
        typeof result.operation_id !== 'string'
        || !result.operation_id
        || result.operation_id !== operationId
      ) {
        throw new Error('La respuesta de incidencia no coincide con operation_id.');
      }

      pendingOperationIds.delete(key);
      return { id: result.id };
    },
  };
}
