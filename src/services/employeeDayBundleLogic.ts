/**
 * Pure validation and access policy for the versioned employee day bundle.
 *
 * The persisted record binds a server response to the authenticated employee
 * and operational day.  A stale record stays readable for orientation, but
 * must never unlock route start or an operational mutation.
 */

export interface DayBundleIdentity {
  companyId: number;
  employeeId: number;
}

export interface DayBundleContext extends DayBundleIdentity {
  operationalDate: string;
  nowMs: number;
}

export interface StoredDayBundle {
  identity: DayBundleIdentity;
  etag: string;
  fetched_at_ms: number;
  bundle: DayBundle;
}

export interface DayBundle {
  schema_version: 'day_bundle.v1';
  operational_date: string;
  expires_at: string | null;
  plan: {
    id: number;
    date: string;
    state: 'published' | 'in_progress';
    route_id: number;
    vehicle_id: number | null;
  };
  stops: unknown[];
  catalog: unknown[];
  directory: unknown[];
  no_sale_reasons: unknown[];
  gift_reasons: unknown[];
  competitors: unknown[];
}

export interface DayBundleAccess {
  mode: 'fresh' | 'stale';
  canRead: true;
  canStartRoute: boolean;
  canRunActions: boolean;
}

function invalid(message: string): Error {
  return new Error(`Day bundle inválido: ${message}`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${field} debe ser un objeto.`);
  }
  return value as Record<string, unknown>;
}

function allowOnly(value: Record<string, unknown>, fields: readonly string[], scope: string): void {
  const unexpected = Object.keys(value).find((field) => !fields.includes(field));
  if (unexpected) throw invalid(`el campo ${scope}.${unexpected} no está permitido.`);
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw invalid(`${field} debe ser un entero positivo.`);
  }
  return value;
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid(`${field} debe ser una fecha ISO.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalid(`${field} debe ser una fecha ISO.`);
  }
  return value;
}

function array(value: unknown, field: string, maxItems: number): unknown[] {
  if (!Array.isArray(value)) throw invalid(`${field} debe ser una lista.`);
  if (value.length > maxItems) throw invalid(`${field} no puede tener más de ${maxItems} elementos.`);
  return value;
}

function expiryMs(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw invalid('expires_at debe ser una fecha válida.');
  // The backend serializes an Odoo UTC datetime without an offset.
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  if (!Number.isFinite(parsed)) throw invalid('expires_at debe ser una fecha válida.');
  return parsed;
}

function validateBundle(value: unknown): DayBundle {
  const data = object(value, 'bundle');
  allowOnly(data, [
    'schema_version', 'operational_date', 'expires_at', 'plan', 'stops', 'catalog', 'directory',
    'no_sale_reasons', 'gift_reasons', 'competitors',
  ], 'bundle');
  if (data.schema_version !== 'day_bundle.v1') throw invalid('schema_version no es day_bundle.v1.');
  const operationalDate = isoDate(data.operational_date, 'operational_date');
  const expiresAt = data.expires_at;
  if (expiresAt !== null && typeof expiresAt !== 'string') throw invalid('expires_at debe ser texto o null.');
  expiryMs(expiresAt);

  const plan = object(data.plan, 'plan');
  allowOnly(plan, ['id', 'date', 'state', 'route_id', 'vehicle_id'], 'plan');
  const state = plan.state;
  if (state !== 'published' && state !== 'in_progress') throw invalid('plan.state no es válido.');
  const vehicleId = plan.vehicle_id;
  if (vehicleId !== null) positiveInteger(vehicleId, 'plan.vehicle_id');

  return {
    schema_version: 'day_bundle.v1',
    operational_date: operationalDate,
    expires_at: expiresAt,
    plan: {
      id: positiveInteger(plan.id, 'plan.id'),
      date: isoDate(plan.date, 'plan.date'),
      state,
      route_id: positiveInteger(plan.route_id, 'plan.route_id'),
      vehicle_id: vehicleId as number | null,
    },
    stops: array(data.stops, 'stops', 1000),
    catalog: array(data.catalog, 'catalog', 10000),
    directory: array(data.directory, 'directory', 1000),
    no_sale_reasons: array(data.no_sale_reasons, 'no_sale_reasons', 200),
    gift_reasons: array(data.gift_reasons, 'gift_reasons', 200),
    competitors: array(data.competitors, 'competitors', 1000),
  };
}

function validateRecord(value: unknown, context: DayBundleContext): StoredDayBundle {
  const record = object(value, 'registro');
  const identity = object(record.identity, 'identidad');
  const companyId = positiveInteger(identity.companyId, 'identidad.companyId');
  const employeeId = positiveInteger(identity.employeeId, 'identidad.employeeId');
  if (companyId !== context.companyId || employeeId !== context.employeeId) {
    throw invalid('la identidad no corresponde a esta sesión.');
  }
  if (typeof record.etag !== 'string' || !record.etag.trim()) throw invalid('etag es requerido.');
  if (typeof record.fetched_at_ms !== 'number' || !Number.isSafeInteger(record.fetched_at_ms) || record.fetched_at_ms <= 0) {
    throw invalid('fetched_at_ms no es válido.');
  }
  const bundle = validateBundle(record.bundle);
  if (bundle.operational_date !== isoDate(context.operationalDate, 'fecha operativa')) {
    throw invalid('la fecha operativa no corresponde a esta sesión.');
  }
  if (bundle.plan.date !== bundle.operational_date) {
    throw invalid('la fecha operativa del plan no corresponde al bundle.');
  }
  return {
    identity: { companyId, employeeId },
    etag: record.etag,
    fetched_at_ms: record.fetched_at_ms,
    bundle,
  };
}

export function evaluateStoredDayBundle(value: unknown, context: DayBundleContext): DayBundleAccess {
  const record = validateRecord(value, context);
  const expiry = expiryMs(record.bundle.expires_at);
  const stale = expiry !== null && expiry <= context.nowMs;
  return stale
    ? { mode: 'stale', canRead: true, canStartRoute: false, canRunActions: false }
    : { mode: 'fresh', canRead: true, canStartRoute: true, canRunActions: true };
}

/**
 * Validate then clone a complete server version.  Callers persist this as the
 * one encrypted `day-bundle` record; no field is merged with an older bundle.
 */
export function replaceDayBundleAtomically(value: unknown, context: DayBundleContext): StoredDayBundle {
  const record = validateRecord(value, context);
  return JSON.parse(JSON.stringify(record)) as StoredDayBundle;
}
