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
  data_quality_warnings: DayBundleDataQualityWarning[];
}

export interface DayBundleDataQualityWarning {
  code: 'negative_credit_used';
  scope: 'stop' | 'directory';
  entity_id: number;
  path: string;
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
  /**
   * Bounded, non-authoritative invoice selection data. Older v1 bundles do
   * not carry this extension, so absence remains valid during rollout.
   */
  invoice_snapshots?: InvoiceSnapshot[];
}

export interface InvoiceSnapshot {
  stop_id: number;
  as_of: string | null;
  invoices: OpenInvoiceSnapshot[];
}

export interface OpenInvoiceSnapshot {
  invoice_id: number;
  name: string;
  invoice_date: string | null;
  due_date: string | null;
  currency: string;
  amount_residual: number;
}

export interface DayBundleAccess {
  mode: 'fresh' | 'stale';
  canRead: true;
  canStartRoute: boolean;
  canRunActions: boolean;
}

function invalid(message: string): Error {
  return new Error(`Datos del día inválidos: ${message}`);
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

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(`${field} debe ser un entero no negativo.`);
  }
  return value;
}

function text(value: unknown, field: string, maxLength: number, required = true): string {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > maxLength) {
    throw invalid(`${field} debe ser texto válido.`);
  }
  return value;
}

function nullableText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null) return null;
  return text(value, field, maxLength, false);
}

function optionalNullableText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  return text(value, field, maxLength, false);
}

function nonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalid(`${field} debe ser un número no negativo.`);
  }
  return value;
}

function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalid(`${field} debe ser un número positivo.`);
  }
  return value;
}

function optionalNumberInRange(value: unknown, field: string, min: number, max: number): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw invalid(`${field} no es válida.`);
  }
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

function nullableIsoDate(value: unknown, field: string): string | null {
  if (value === null) return null;
  return isoDate(value, field);
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

function paymentTerm(value: unknown, field: string): void {
  if (value === null) return;
  const term = object(value, field);
  allowOnly(term, ['id', 'name'], field);
  positiveInteger(term.id, `${field}.id`);
  text(term.name, `${field}.name`, 256, false);
}

function creditUsed(
  value: unknown,
  field: string,
  warning: Omit<DayBundleDataQualityWarning, 'code' | 'path'>,
  warnings: DayBundleDataQualityWarning[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${field} debe ser un número.`);
  }
  if (value < 0) {
    warnings.push({
      code: 'negative_credit_used',
      ...warning,
      path: field,
    });
  }
}

function paymentPolicy(
  value: unknown,
  field: string,
  warning: Omit<DayBundleDataQualityWarning, 'code' | 'path'>,
  warnings: DayBundleDataQualityWarning[],
): void {
  if (value === undefined) return;
  const policy = object(value, field);
  allowOnly(policy, [
    'mode',
    'allowed_payment_methods',
    'credit_limit',
    'credit_used',
    'credit_available',
    'credit_overdue',
    'credit_over_limit',
    'credit_hold',
    'payment_term',
  ], field);
  // credit_only is intentionally not accepted: the backend never emits it.
  if (!['cash_only', 'credit_allowed', 'blocked'].includes(policy.mode as string)) {
    throw invalid(`${field}.mode no es válido.`);
  }
  const methods = array(policy.allowed_payment_methods, `${field}.allowed_payment_methods`, 8);
  methods.forEach((method, index) => {
    if (method !== 'cash' && method !== 'credit') {
      throw invalid(`${field}.allowed_payment_methods[${index}] no es válido.`);
    }
  });
  nonNegativeNumber(policy.credit_limit, `${field}.credit_limit`);
  creditUsed(policy.credit_used, `${field}.credit_used`, warning, warnings);
  nonNegativeNumber(policy.credit_available, `${field}.credit_available`);
  if (typeof policy.credit_overdue !== 'boolean') throw invalid(`${field}.credit_overdue debe ser booleano.`);
  // Older bundles may omit credit_over_limit; default false when absent.
  if (policy.credit_over_limit === undefined) {
    (policy as Record<string, unknown>).credit_over_limit = false;
  } else if (typeof policy.credit_over_limit !== 'boolean') {
    throw invalid(`${field}.credit_over_limit debe ser booleano.`);
  }
  if (typeof policy.credit_hold !== 'boolean') throw invalid(`${field}.credit_hold debe ser booleano.`);
  paymentTerm(policy.payment_term, `${field}.payment_term`);
}

function customer(value: unknown, field: string): void {
  if (value === null) return;
  const entry = object(value, field);
  allowOnly(entry, ['id', 'name'], field);
  positiveInteger(entry.id, `${field}.id`);
  text(entry.name, `${field}.name`, 512, false);
}

function reason(value: unknown, field: string): void {
  const entry = object(value, field);
  allowOnly(entry, ['code', 'name'], field);
  text(entry.code, `${field}.code`, 128);
  text(entry.name, `${field}.name`, 256, false);
}

function validateStops(values: unknown[], warnings: DayBundleDataQualityWarning[]): void {
  values.forEach((value, index) => {
    const field = `stops[${index}]`;
    const entry = object(value, field);
    allowOnly(entry, ['id', 'sequence', 'state', 'kind', 'customer', 'payment_term', 'payment_policy'], field);
    const id = positiveInteger(entry.id, `${field}.id`);
    nonNegativeInteger(entry.sequence, `${field}.sequence`);
    if (!['pending', 'in_progress', 'done'].includes(entry.state as string)) throw invalid(`${field}.state no es válido.`);
    if (!['customer', 'lead'].includes(entry.kind as string)) throw invalid(`${field}.kind no es válido.`);
    customer(entry.customer, `${field}.customer`);
    paymentTerm(entry.payment_term, `${field}.payment_term`);
    paymentPolicy(entry.payment_policy, `${field}.payment_policy`, { scope: 'stop', entity_id: id }, warnings);
  });
}

function validateCatalog(values: unknown[]): void {
  values.forEach((value, index) => {
    const field = `catalog[${index}]`;
    const entry = object(value, field);
    allowOnly(entry, ['id', 'name', 'default_code', 'uom_id', 'stock_qty', 'effective_prices'], field);
    positiveInteger(entry.id, `${field}.id`);
    text(entry.name, `${field}.name`, 512, false);
    nullableText(entry.default_code, `${field}.default_code`, 256);
    positiveInteger(entry.uom_id, `${field}.uom_id`);
    nonNegativeNumber(entry.stock_qty, `${field}.stock_qty`);
    const prices = array(entry.effective_prices, `${field}.effective_prices`, 1000);
    prices.forEach((price, priceIndex) => {
      const priceField = `${field}.effective_prices[${priceIndex}]`;
      const effective = object(price, priceField);
      allowOnly(effective, ['partner_id', 'price'], priceField);
      positiveInteger(effective.partner_id, `${priceField}.partner_id`);
      nonNegativeNumber(effective.price, `${priceField}.price`);
    });
  });
}

function validateDirectory(values: unknown[], warnings: DayBundleDataQualityWarning[]): void {
  values.forEach((value, index) => {
    const field = `directory[${index}]`;
    const entry = object(value, field);
    allowOnly(entry, ['id', 'name', 'payment_term', 'payment_policy', 'zone', 'address', 'latitude', 'longitude'], field);
    const id = positiveInteger(entry.id, `${field}.id`);
    text(entry.name, `${field}.name`, 512, false);
    paymentTerm(entry.payment_term, `${field}.payment_term`);
    paymentPolicy(entry.payment_policy, `${field}.payment_policy`, { scope: 'directory', entity_id: id }, warnings);
    optionalNullableText(entry.zone, `${field}.zone`, 256);
    optionalNullableText(entry.address, `${field}.address`, 512);
    optionalNumberInRange(entry.latitude, `${field}.latitude`, -90, 90);
    optionalNumberInRange(entry.longitude, `${field}.longitude`, -180, 180);
  });
}

function validateInvoiceSnapshots(values: unknown[]): InvoiceSnapshot[] {
  return values.map((value, index) => {
    const field = `invoice_snapshots[${index}]`;
    const snapshot = object(value, field);
    allowOnly(snapshot, ['stop_id', 'as_of', 'invoices'], field);
    const invoices = array(snapshot.invoices, `${field}.invoices`, 100).map((invoice, invoiceIndex) => {
      const invoiceField = `${field}.invoices[${invoiceIndex}]`;
      const entry = object(invoice, invoiceField);
      allowOnly(entry, ['invoice_id', 'name', 'invoice_date', 'due_date', 'currency', 'amount_residual'], invoiceField);
      return {
        invoice_id: positiveInteger(entry.invoice_id, `${invoiceField}.invoice_id`),
        name: text(entry.name, `${invoiceField}.name`, 256),
        invoice_date: nullableIsoDate(entry.invoice_date, `${invoiceField}.invoice_date`),
        due_date: nullableIsoDate(entry.due_date, `${invoiceField}.due_date`),
        currency: text(entry.currency, `${invoiceField}.currency`, 16),
        amount_residual: positiveNumber(entry.amount_residual, `${invoiceField}.amount_residual`),
      };
    });
    return {
      stop_id: positiveInteger(snapshot.stop_id, `${field}.stop_id`),
      as_of: nullableText(snapshot.as_of, `${field}.as_of`, 32),
      invoices,
    };
  });
}

function validateBundle(value: unknown, warnings: DayBundleDataQualityWarning[]): DayBundle {
  const data = object(value, 'bundle');
  allowOnly(data, [
    'schema_version', 'operational_date', 'expires_at', 'plan', 'stops', 'catalog', 'directory',
    'no_sale_reasons', 'gift_reasons', 'competitors', 'invoice_snapshots',
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

  const stops = array(data.stops, 'stops', 1000);
  const catalog = array(data.catalog, 'catalog', 10000);
  const directory = array(data.directory, 'directory', 1000);
  const noSaleReasons = array(data.no_sale_reasons, 'no_sale_reasons', 200);
  const giftReasons = array(data.gift_reasons, 'gift_reasons', 200);
  const competitors = array(data.competitors, 'competitors', 1000);
  const invoiceSnapshots = data.invoice_snapshots === undefined
    ? undefined
    : validateInvoiceSnapshots(array(data.invoice_snapshots, 'invoice_snapshots', 1000));
  validateStops(stops, warnings);
  validateCatalog(catalog);
  validateDirectory(directory, warnings);
  noSaleReasons.forEach((entry, index) => reason(entry, `no_sale_reasons[${index}]`));
  giftReasons.forEach((entry, index) => reason(entry, `gift_reasons[${index}]`));
  competitors.forEach((entry, index) => reason(entry, `competitors[${index}]`));

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
    stops,
    catalog,
    directory,
    no_sale_reasons: noSaleReasons,
    gift_reasons: giftReasons,
    competitors,
    ...(invoiceSnapshots === undefined ? {} : { invoice_snapshots: invoiceSnapshots }),
  };
}

function validateRecord(
  value: unknown,
  context: DayBundleContext,
  options: { requireOperationalDateMatch?: boolean } = {},
): StoredDayBundle {
  const requireOperationalDateMatch = options.requireOperationalDateMatch !== false;
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
  const dataQualityWarnings: DayBundleDataQualityWarning[] = [];
  const bundle = validateBundle(record.bundle, dataQualityWarnings);
  if (bundle.plan.date !== bundle.operational_date) {
    throw invalid('la fecha operativa del plan no corresponde al bundle.');
  }
  if (requireOperationalDateMatch) {
    if (bundle.operational_date !== isoDate(context.operationalDate, 'fecha operativa')) {
      throw invalid('la fecha operativa no corresponde a esta sesión.');
    }
  }
  return {
    identity: { companyId, employeeId },
    etag: record.etag,
    fetched_at_ms: record.fetched_at_ms,
    bundle,
    data_quality_warnings: dataQualityWarnings,
  };
}

/**
 * Offline lease is governed by ``expires_at`` (company-local next midnight as
 * UTC), not by the device calendar date alone. Crossing local midnight while
 * the lease is still active must not strand the seller mid-route.
 *
 * After ``expires_at``: readable orientation only (stale). Mutations require a
 * fresh download for the new operational day.
 */
export function evaluateStoredDayBundle(value: unknown, context: DayBundleContext): DayBundleAccess {
  const record = validateRecord(value, context, { requireOperationalDateMatch: false });
  const expiry = expiryMs(record.bundle.expires_at);
  const stale = expiry !== null && expiry <= context.nowMs;
  return stale
    ? { mode: 'stale', canRead: true, canStartRoute: false, canRunActions: false }
    : { mode: 'fresh', canRead: true, canStartRoute: true, canRunActions: true };
}

/**
 * Validate then clone a complete server version.  Callers persist this as the
 * one encrypted `day-bundle` record; no field is merged with an older bundle.
 *
 * When accepting a **new** HTTP body, pass ``requireOperationalDateMatch: true``
 * (default). Cached offline reads used only for ETag / lease evaluation may
 * pass ``false`` so a device-date rollover before ``expires_at`` does not wipe
 * the in-hand lease.
 */
export function replaceDayBundleAtomically(
  value: unknown,
  context: DayBundleContext,
  options: { requireOperationalDateMatch?: boolean } = {},
): StoredDayBundle {
  const record = validateRecord(value, context, options);
  return JSON.parse(JSON.stringify(record)) as StoredDayBundle;
}
