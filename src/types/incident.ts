/**
 * Incident types for the route incident flow (Sprint B).
 *
 * Backend model `gf.route.incident` enum (confirmed via PWA Colaboradores,
 * production-proven):
 *   incident_type: operation | customer | quality | collection | vehicle
 *   severity:      low | medium | high
 *
 * Contract (POST /pwa-ruta/incident-create): { incident_type, severity, name }.
 * The PWA does NOT send plan/stop context — the controller derives the
 * employee/company from the token. Richer association (stop/plan) is NOT in
 * the current contract (see SPRINT-B notes).
 */

export type IncidentTypeBackend =
  | 'operation'
  | 'customer'
  | 'quality'
  | 'collection'
  | 'vehicle';

export type IncidentSeverityBackend = 'low' | 'medium' | 'high';

export interface IncidentCategory {
  key: string;
  label: string;
  backend: IncidentTypeBackend;
}

export interface IncidentSeverityOption {
  key: string;
  label: string;
  backend: IncidentSeverityBackend;
}

export interface CreateIncidentPayload {
  incident_type: IncidentTypeBackend;
  severity: IncidentSeverityBackend;
  name: string;
}

export interface GFIncident {
  id: number;
  incident_type: string;
  severity: string;
  name: string;
  created_at: string;
}
