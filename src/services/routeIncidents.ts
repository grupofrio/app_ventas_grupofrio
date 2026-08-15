/** Employee-scoped route incident service. */

import { createUuidV4 } from '../utils/clientEvent';
import { logInfo } from '../utils/logger';
import { createEmployeeIncident, listEmployeeIncidents } from './employeeData';
import { CreateIncidentPayload, GFIncident } from '../types/incident';

/**
 * Creates an incident only for the authenticated employee's scoped stop.
 * No employee/company authority is accepted from the caller or sent on wire.
 */
export async function createIncident(
  payload: CreateIncidentPayload,
  stopId: number,
): Promise<void> {
  await createEmployeeIncident({
    operation_id: createUuidV4(),
    stop_id: stopId,
    name: payload.name,
    incident_type: payload.incident_type,
    severity: payload.severity,
    requires_follow_up: true,
  });
  logInfo('general', 'route_incident_create', {
    incident_type: payload.incident_type,
    severity: payload.severity,
    stop_id: stopId,
  });
}

/** List incidents visible through the authenticated employee's current plan. */
export async function getMyIncidents(): Promise<GFIncident[]> {
  const stops = await listEmployeeIncidents();
  return stops
    .flatMap((stop) => stop.incidents.map((incident) => ({
      id: incident.id,
      incident_type: incident.incident_type,
      severity: incident.severity,
      name: incident.name,
      // The bounded DTO deliberately does not disclose create_date.
      created_at: '',
    })))
    .sort((a, b) => b.id - a.id);
}
