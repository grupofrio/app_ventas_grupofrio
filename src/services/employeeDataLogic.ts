type UnknownRecord = Record<string, unknown>;

type RestPost = (
  url: string,
  data: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<unknown>;

type EmployeeDataClientInput = {
  postRest: RestPost;
  readTimeoutMs: number;
};

const EMPLOYEE_API = '/gf/logistics/api/employee';
const INCIDENT_TYPES = new Set(['operation', 'customer', 'quality', 'collection', 'vehicle']);
const INCIDENT_SEVERITIES = new Set(['low', 'medium', 'high']);
const MAX_INCIDENT_OPERATION_ID_LENGTH = 120;
const MAX_INCIDENT_NOTE_LENGTH = 2_000;

export type EmployeeIncidentCreatePayload = {
  operation_id: string;
  plan_id: number;
  stop_id?: number;
  incident_type: string;
  severity: string;
  note?: string;
};

export type EmployeeIncidentListOptions = {
  plan_id?: number;
  limit?: number;
  offset?: number;
};

export type EmployeeIncidentRecord = {
  id: number;
  operation_id: string;
  plan_id: number | null;
  stop_id: number | null;
  incident_type: string;
  severity: string;
  note: string;
};

export type EmployeeKoldScore = {
  id: number;
  partner_id: number;
  score_master: number;
  strategic_category: string;
  priority_level: string;
  suggested_action: string;
  recommendation_summary: string;
  last_scored_at: string;
};

export type EmployeeKoldForecast = {
  id: number;
  partner_id: number;
  forecast_date: string;
  predicted_kg: number;
  probability_of_purchase: number;
  confidence_level: string;
  confidence_score: number;
};

export type EmployeeKoldInsights = {
  scores_available: boolean;
  forecasts_available: boolean;
  scores: EmployeeKoldScore[];
  forecasts: EmployeeKoldForecast[];
};

const EMPTY_KOLD_INSIGHTS: EmployeeKoldInsights = {
  scores_available: false,
  forecasts_available: false,
  scores: [],
  forecasts: [],
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function unwrapEmployeeEnvelope<T>(result: unknown): T | null {
  if (!isRecord(result)) return null;
  const data = result.data === undefined ? result : result.data;
  return isRecord(data) ? data as T : null;
}

function assertPositivePartnerId(partnerId: number): void {
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    throw new Error('partner_id debe ser un entero positivo.');
  }
}

function assertPositiveId(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} debe ser un entero positivo.`);
  }
  return value;
}

function normalizeOptionalPositiveId(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null) return null;
  return assertPositiveId(value, fieldName);
}

function assertBoundedInteger(value: unknown, fieldName: string, max: number, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} debe ser un entero no negativo.`);
  }
  return Math.min(value, max);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizePositiveId(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function normalizeEmployeeIncident(value: unknown): EmployeeIncidentRecord | null {
  if (!isRecord(value)) return null;
  const id = normalizePositiveId(value.id);
  if (!id) return null;
  return {
    id,
    operation_id: normalizeString(value.operation_id),
    plan_id: normalizeOptionalPositiveIdForResponse(value.plan_id),
    stop_id: normalizeOptionalPositiveIdForResponse(value.stop_id),
    incident_type: normalizeString(value.incident_type),
    severity: normalizeString(value.severity),
    note: normalizeString(value.note),
  };
}

function requireEmployeeIncidentConfirmation(
  value: unknown,
  expectedOperationId: string,
): EmployeeIncidentRecord {
  const incident = normalizeEmployeeIncident(value);
  if (!incident) {
    throw new Error('El servidor no confirmó la incidencia.');
  }
  if (
    !isRecord(value)
    || typeof value.operation_id !== 'string'
    || !value.operation_id
    || value.operation_id !== expectedOperationId
  ) {
    throw new Error('La respuesta de incidencia no coincide con operation_id.');
  }
  return incident;
}

function normalizeOptionalPositiveIdForResponse(value: unknown): number | null {
  const id = normalizePositiveId(value);
  return id || null;
}

function normalizeKoldScore(value: unknown): EmployeeKoldScore | null {
  if (!isRecord(value)) return null;
  const partnerId = normalizePositiveId(value.partner_id);
  if (!partnerId) return null;
  return {
    id: normalizePositiveId(value.id),
    partner_id: partnerId,
    score_master: normalizeFiniteNumber(value.score_master),
    strategic_category: normalizeString(value.strategic_category),
    priority_level: normalizeString(value.priority_level),
    suggested_action: normalizeString(value.suggested_action),
    recommendation_summary: normalizeString(value.recommendation_summary),
    last_scored_at: normalizeString(value.last_scored_at),
  };
}

function normalizeKoldForecast(value: unknown): EmployeeKoldForecast | null {
  if (!isRecord(value)) return null;
  const partnerId = normalizePositiveId(value.partner_id);
  if (!partnerId) return null;
  return {
    id: normalizePositiveId(value.id),
    partner_id: partnerId,
    forecast_date: normalizeString(value.forecast_date),
    predicted_kg: normalizeFiniteNumber(value.predicted_kg),
    probability_of_purchase: normalizeFiniteNumber(value.probability_of_purchase),
    confidence_level: normalizeString(value.confidence_level),
    confidence_score: normalizeFiniteNumber(value.confidence_score),
  };
}

function normalizeKoldInsights(value: unknown): EmployeeKoldInsights {
  const data = unwrapEmployeeEnvelope<UnknownRecord>(value);
  if (!data) return EMPTY_KOLD_INSIGHTS;
  return {
    scores_available: data.scores_available === true,
    forecasts_available: data.forecasts_available === true,
    scores: Array.isArray(data.scores)
      ? data.scores.map(normalizeKoldScore).filter((item): item is EmployeeKoldScore => item !== null)
      : [],
    forecasts: Array.isArray(data.forecasts)
      ? data.forecasts.map(normalizeKoldForecast).filter((item): item is EmployeeKoldForecast => item !== null)
      : [],
  };
}

function normalizeKoldPartnerIds(partnerIds: unknown): number[] {
  if (!Array.isArray(partnerIds)) {
    throw new Error('partner_ids debe ser una lista.');
  }
  if (partnerIds.length > 500) {
    throw new Error('partner_ids no puede exceder 500 elementos.');
  }
  const result: number[] = [];
  for (const partnerId of partnerIds) {
    const id = assertPositiveId(partnerId, 'partner_id');
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

function buildEmployeeIncidentCreatePayload(payload: EmployeeIncidentCreatePayload): Record<string, unknown> {
  const operationId = typeof payload.operation_id === 'string' ? payload.operation_id.trim() : '';
  if (!operationId || operationId.length > MAX_INCIDENT_OPERATION_ID_LENGTH) {
    throw new Error('operation_id es obligatorio y debe tener máximo 120 caracteres.');
  }
  const incidentType = typeof payload.incident_type === 'string' ? payload.incident_type.trim().toLowerCase() : '';
  if (!INCIDENT_TYPES.has(incidentType)) {
    throw new Error('incident_type no es válido.');
  }
  const severity = typeof payload.severity === 'string' ? payload.severity.trim().toLowerCase() : '';
  if (!INCIDENT_SEVERITIES.has(severity)) {
    throw new Error('severity no es válida.');
  }
  const note = payload.note === undefined ? '' : typeof payload.note === 'string' ? payload.note.trim() : null;
  if (note === null || note.length > MAX_INCIDENT_NOTE_LENGTH) {
    throw new Error('note debe ser texto de máximo 2000 caracteres.');
  }

  const body: Record<string, unknown> = {
    operation_id: operationId,
    plan_id: assertPositiveId(payload.plan_id, 'plan_id'),
    incident_type: incidentType,
    severity,
    note,
  };
  const stopId = normalizeOptionalPositiveId(payload.stop_id, 'stop_id');
  if (stopId) body.stop_id = stopId;
  return body;
}

function clampDirectoryLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(20, Math.trunc(limit)));
}

export function createEmployeeDataClient({
  postRest,
  readTimeoutMs,
}: EmployeeDataClientInput) {
  return {
    async searchEmployeeDirectory(
      query: string,
      limit = 20,
    ): Promise<{ customers: unknown[]; leads: unknown[] }> {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        return { customers: [], leads: [] };
      }

      const result = await postRest(
        `${EMPLOYEE_API}/directory/search`,
        { query: normalizedQuery, limit: clampDirectoryLimit(limit) },
        { timeoutMs: readTimeoutMs },
      );
      const data = unwrapEmployeeEnvelope<UnknownRecord>(result) ?? {};
      return {
        customers: Array.isArray(data.customers) ? data.customers : [],
        leads: Array.isArray(data.leads) ? data.leads : [],
      };
    },

    async getEmployeeScopedLoyalty(
      partnerId: number,
    ): Promise<Record<string, unknown> | null> {
      assertPositivePartnerId(partnerId);
      const result = await postRest(
        `${EMPLOYEE_API}/customer/loyalty`,
        { partner_id: partnerId },
        { timeoutMs: readTimeoutMs },
      );
      const data = unwrapEmployeeEnvelope<UnknownRecord>(result);
      return isRecord(data?.customer) ? data.customer : null;
    },

    async updateEmployeeScopedContact(
      partnerId: number,
      values: Record<string, string | false>,
    ): Promise<Record<string, unknown> | null> {
      assertPositivePartnerId(partnerId);
      const result = await postRest(
        `${EMPLOYEE_API}/customer/contact/update`,
        { partner_id: partnerId, values },
      );
      const data = unwrapEmployeeEnvelope<UnknownRecord>(result);
      return isRecord(data?.customer) ? data.customer : null;
    },

    async createEmployeeIncident(
      payload: EmployeeIncidentCreatePayload,
    ): Promise<EmployeeIncidentRecord> {
      const requestPayload = buildEmployeeIncidentCreatePayload(payload);
      const result = await postRest(
        `${EMPLOYEE_API}/incidents/create`,
        requestPayload,
      );
      const data = unwrapEmployeeEnvelope<UnknownRecord>(result);
      return requireEmployeeIncidentConfirmation(data?.incident, requestPayload.operation_id as string);
    },

    async listEmployeeIncidents(
      options: EmployeeIncidentListOptions = {},
    ): Promise<EmployeeIncidentRecord[]> {
      const body: Record<string, unknown> = {
        limit: assertBoundedInteger(options.limit, 'limit', 100, 50),
        offset: assertBoundedInteger(options.offset, 'offset', 10_000, 0),
      };
      const planId = normalizeOptionalPositiveId(options.plan_id, 'plan_id');
      if (planId) body.plan_id = planId;
      const result = await postRest(
        `${EMPLOYEE_API}/incidents/list`,
        body,
        { timeoutMs: readTimeoutMs },
      );
      const data = unwrapEmployeeEnvelope<UnknownRecord>(result) ?? {};
      return Array.isArray(data.incidents)
        ? data.incidents
            .map(normalizeEmployeeIncident)
            .filter((item): item is EmployeeIncidentRecord => item !== null)
        : [];
    },

    async getKoldInsights(partnerIds: number[]): Promise<EmployeeKoldInsights> {
      const normalizedPartnerIds = normalizeKoldPartnerIds(partnerIds);
      const result = await postRest(
        `${EMPLOYEE_API}/kold/insights`,
        { partner_ids: normalizedPartnerIds },
        { timeoutMs: readTimeoutMs },
      );
      return normalizeKoldInsights(result);
    },
  };
}
