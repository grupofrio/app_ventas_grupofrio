/**
 * Bounded employee-scoped REST adapters.
 *
 * These contracts never accept employee/company selectors. Odoo derives that
 * authority exclusively from the Bearer session in `postRest`.
 */

import { postRest } from './api';
import {
  normalizeEmployeeDateQuery,
  normalizeEmployeeIncidentCreate,
  objectPayload,
  positiveId,
  shortChoice,
  shortString,
  validationError,
} from './employeeDataLogic';
export { normalizeEmployeeDateQuery, normalizeEmployeeIncidentCreate } from './employeeDataLogic';

const EMPLOYEE_API_BASE = '/gf/logistics/api/employee';

export type EmployeeIncidentType = 'operation' | 'customer' | 'quality' | 'collection' | 'vehicle';
export type EmployeeIncidentSeverity = 'low' | 'medium' | 'high';

export interface EmployeeIncidentCreateInput {
  operation_id: string;
  stop_id: number;
  name: string;
  incident_type: EmployeeIncidentType;
  severity: EmployeeIncidentSeverity;
  requires_follow_up?: boolean;
}

export interface EmployeeIncident {
  id: number;
  name: string;
  incident_type: EmployeeIncidentType;
  severity: EmployeeIncidentSeverity;
  requires_follow_up: boolean;
}

export interface EmployeeIncidentStop {
  stop_id: number;
  incidents: EmployeeIncident[];
}

export interface EmployeeKoldInsights {
  plan_id: number | null;
  stops_total: number;
  stops_with_incidents: number;
}

interface EmployeeRestResponse<T> {
  ok: true;
  message: string;
  data: T;
}

function responseData<T>(response: EmployeeRestResponse<T>): T {
  if (!response || response.ok !== true || !response.data || typeof response.data !== 'object') {
    throw validationError('La respuesta del servidor no cumple el contrato de empleado.');
  }
  return response.data;
}

function serializeIncident(value: unknown): EmployeeIncident {
  const data = objectPayload(value as Record<string, unknown>);
  return {
    id: positiveId(data.id, 'incident.id'),
    name: shortString(data.name, 'incident.name', 160),
    incident_type: shortChoice(data.incident_type, 'incident.incident_type', [
      'operation', 'customer', 'quality', 'collection', 'vehicle',
    ]),
    severity: shortChoice(data.severity, 'incident.severity', ['low', 'medium', 'high']),
    requires_follow_up: typeof data.requires_follow_up === 'boolean' ? data.requires_follow_up : false,
  };
}

export async function createEmployeeIncident(
  payload: EmployeeIncidentCreateInput,
): Promise<{ incident: EmployeeIncident; stop_id: number }> {
  const request = normalizeEmployeeIncidentCreate(payload as unknown as Record<string, unknown>);
  const response = await postRest<EmployeeRestResponse<{ incident: unknown; stop_id: unknown }>>(
    `${EMPLOYEE_API_BASE}/incidents/create`,
    request,
  );
  const data = responseData(response);
  return {
    incident: serializeIncident(data.incident),
    stop_id: positiveId(data.stop_id, 'stop_id'),
  };
}

export async function listEmployeeIncidents(
  query: Record<string, unknown> = {},
): Promise<EmployeeIncidentStop[]> {
  const request = normalizeEmployeeDateQuery(query);
  const response = await postRest<EmployeeRestResponse<{ incidents: unknown }>>(
    `${EMPLOYEE_API_BASE}/incidents/list`,
    request,
  );
  const data = responseData(response);
  if (!Array.isArray(data.incidents)) {
    throw validationError('La respuesta de incidencias no es válida.');
  }
  return data.incidents.map((entry) => {
    const stop = objectPayload(entry as Record<string, unknown>);
    if (!Array.isArray(stop.incidents)) {
      throw validationError('La respuesta de incidencias no es válida.');
    }
    return {
      stop_id: positiveId(stop.stop_id, 'stop_id'),
      incidents: stop.incidents.map(serializeIncident),
    };
  });
}

export async function getEmployeeKoldInsights(
  query: Record<string, unknown> = {},
): Promise<EmployeeKoldInsights> {
  const request = normalizeEmployeeDateQuery(query);
  const response = await postRest<EmployeeRestResponse<Record<string, unknown>>>(
    `${EMPLOYEE_API_BASE}/kold/insights`,
    request,
  );
  const data = responseData(response);
  const planId = data.plan_id;
  const normalizedPlanId = planId === null || planId === undefined
    ? null
    : positiveId(planId, 'plan_id');
  if (typeof data.stops_total !== 'number' || !Number.isInteger(data.stops_total) || data.stops_total < 0) {
    throw validationError('stops_total no es válido.');
  }
  if (
    typeof data.stops_with_incidents !== 'number'
    || !Number.isInteger(data.stops_with_incidents)
    || data.stops_with_incidents < 0
  ) {
    throw validationError('stops_with_incidents no es válido.');
  }
  return {
    plan_id: normalizedPlanId,
    stops_total: data.stops_total,
    stops_with_incidents: data.stops_with_incidents,
  };
}
