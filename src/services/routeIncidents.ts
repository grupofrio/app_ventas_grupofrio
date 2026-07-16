/**
 * Incidencias de ruta mediante los endpoints REST acotados por la sesión del
 * empleado. La identidad, compañía y plaza se derivan exclusivamente del token
 * de sesión en el servidor; los argumentos legacy se conservan para no romper
 * callers, pero no forman parte de ninguna petición.
 */

import {
  createEmployeeIncident,
  listEmployeeIncidents,
} from './employeeData';
import { useRouteStore } from '../stores/useRouteStore';
import { logInfo } from '../utils/logger';
import { CreateIncidentPayload, GFIncident } from '../types/incident';
import { createIncidentSubmissionService } from './routeIncidentLogic';

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function createOperationId(): string {
  return `incident-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function activePlanId(): number | null {
  return positiveInteger(useRouteStore.getState().plan?.plan_id);
}

const incidentSubmissionService = createIncidentSubmissionService({
  createEmployeeIncident,
  createOperationId,
});

/**
 * Mantiene la firma pública anterior para los callers UI. employeeId y
 * companyId son compatibilidad temporal y se ignoran: el servidor resuelve el
 * alcance desde la sesión. La ruta activa aporta el contexto requerido por el
 * contrato seguro de incidencias.
 */
export async function createIncident(
  payload: CreateIncidentPayload,
  _legacyEmployeeId?: number,
  _legacyCompanyId?: number,
): Promise<void> {
  const planId = activePlanId();
  if (!planId) {
    throw new Error('No hay una ruta activa para registrar la incidencia.');
  }
  await incidentSubmissionService.submit({ planId, payload });
  logInfo('general', 'route_incident_create', {
    incident_type: payload.incident_type,
    severity: payload.severity,
    plan_id: planId,
  });
}

/**
 * Devuelve únicamente incidencias autorizadas por la sesión del empleado.
 * employeeId se conserva como parámetro legacy y no se transmite al backend.
 */
export async function getMyIncidents(_legacyEmployeeId?: number): Promise<GFIncident[]> {
  const incidents = await listEmployeeIncidents();
  return incidents.map((incident) => ({
    id: positiveInteger(incident.id) ?? 0,
    incident_type: stringValue(incident.incident_type),
    severity: stringValue(incident.severity),
    name: stringValue(incident.note),
    created_at: '',
  }));
}
