import { positiveId, shortChoice, shortString, validationError } from './employeeDataLogic.ts';
import type { CustomerDeactivationScope, CustomerDeactivationSummary } from '../types/customerDeactivation';
import type { GFPlan, GFStop } from '../types/plan';
import type {
  CustomerDeactivationReason,
  CustomerDeactivationReasonOption,
  CustomerDeactivationRequestPayload,
  CustomerDeactivationState,
} from '../types/customerDeactivation';

export const DEACTIVATION_REASONS: CustomerDeactivationReasonOption[] = [
  { value: 'not_exists', label: 'Cliente ya no existe', requiresPhoto: true },
  { value: 'permanently_closed', label: 'Cerrado permanentemente', requiresPhoto: true },
  { value: 'does_not_want_buy', label: 'No quiere comprar', requiresPhoto: false },
  { value: 'moved', label: 'Cambio de domicilio', requiresPhoto: false },
  { value: 'duplicate', label: 'Duplicado', requiresPhoto: false },
  { value: 'other', label: 'Otro', requiresPhoto: false },
];

const REASON_VALUES = new Set(DEACTIVATION_REASONS.map((reason) => reason.value));

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function isValidGps(latitude: number | null | undefined, longitude: number | null | undefined): boolean {
  return typeof latitude === 'number'
    && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number'
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

export function requiresCustomerDeactivationPhoto(reason: string | null | undefined): boolean {
  return DEACTIVATION_REASONS.some((option) => option.value === reason && option.requiresPhoto);
}

export function validateCustomerDeactivationRequest(input: {
  reason: string | null;
  comment: string;
  localPhotoUri?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string | null {
  if (!input.reason || !REASON_VALUES.has(input.reason as CustomerDeactivationReason)) {
    return 'Selecciona el motivo de la posible baja.';
  }
  if (!clean(input.comment)) {
    return 'El comentario es obligatorio.';
  }
  if (!isValidGps(input.latitude, input.longitude)) {
    return 'GPS obligatorio para levantar la solicitud.';
  }
  if (requiresCustomerDeactivationPhoto(input.reason) && !clean(input.localPhotoUri)) {
    return 'La foto es obligatoria para este motivo.';
  }
  return null;
}

export function buildCustomerDeactivationRequestPayload(input: {
  clientOperationId: string;
  stop: Pick<GFStop, 'id' | 'customer_id' | 'customer_name' | '_partnerId'>;
  plan: Pick<GFPlan, 'plan_id' | 'route'> | null;
  scope: CustomerDeactivationScope;
  form: {
    reason: CustomerDeactivationReason | string;
    comment: string;
    contactPerson?: string;
    localPhotoUri?: string | null;
  };
  gps: { latitude: number; longitude: number; accuracy?: number | null };
  capturedAt: string;
}): CustomerDeactivationRequestPayload {
  return {
    operation_id: input.clientOperationId,
    partner_id: input.stop._partnerId || input.stop.customer_id,
    partner_name: input.stop.customer_name,
    route_plan_id: input.scope.planId,
    route_name: input.plan?.route ?? null,
    company_id: input.scope.companyId,
    stop_id: input.stop.id,
    _deactivationScope: input.scope,
    reason: input.form.reason as CustomerDeactivationReason,
    comment: clean(input.form.comment),
    contact_person: clean(input.form.contactPerson) || null,
    latitude: input.gps.latitude,
    longitude: input.gps.longitude,
    accuracy: input.gps.accuracy ?? null,
    captured_at: input.capturedAt,
    localPhotoUri: input.form.localPhotoUri ?? null,
  };
}

export function buildCustomerDeactivationStopPatch(input: {
  requestId?: number | null;
  state?: string | null;
  reason: string;
}): {
  deactivation_request_id: number | null;
  deactivation_state: CustomerDeactivationState | string;
  deactivation_reason: string;
  deactivation_under_review: boolean;
} {
  return {
    deactivation_request_id: input.requestId ?? null,
    deactivation_state: input.state ?? 'queued',
    deactivation_reason: input.reason,
    deactivation_under_review: isCustomerDeactivationUnderReview(input.state),
  };
}

export const DEACTIVATION_STATES = ['reported', 'pending_sugey', 'sugey_verified', 'pending_angelica', 'angelica_approved', 'final_odoo_review', 'approved', 'rejected', 'second_visit_required', 'commercial_recovery', 'applied'] as const;

export function isCustomerDeactivationUnderReview(state?: string | null): boolean {
  return DEACTIVATION_STATES.includes(state as CustomerDeactivationState) && state !== 'rejected' && state !== 'applied';
}

export function sameCustomerDeactivationScope(a: CustomerDeactivationScope | null | undefined, b: CustomerDeactivationScope | null | undefined): boolean {
  return !!a && !!b && a.companyId === b.companyId && a.employeeId === b.employeeId
    && a.sessionId === b.sessionId && a.partnerId === b.partnerId && a.planId === b.planId && a.operationalDate === b.operationalDate;
}

export function normalizeCustomerDeactivationPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = ['operation_id', 'stop_id', 'reason', 'comment', 'contact_person', 'latitude', 'longitude', 'accuracy', 'captured_at', 'localPhotoUri', '_deactivationScope', '_operationId', 'partner_id', 'partner_name', 'route_plan_id', 'route_name', 'company_id'];
  if (Object.keys(payload).some(key => !allowed.includes(key))) throw validationError('Campo no permitido en solicitud de baja.');
  const operationId = shortString(payload.operation_id, 'operation_id', 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) throw validationError('operation_id debe ser UUID v4.');
  const reason = shortChoice(payload.reason, 'reason', DEACTIVATION_REASONS.map(r => r.value));
  const comment = shortString(payload.comment, 'comment', 2000);
  const error = validateCustomerDeactivationRequest({reason, comment, latitude: payload.latitude as number, longitude: payload.longitude as number, localPhotoUri: payload.localPhotoUri as string});
  if (error) throw validationError(error);
  const capturedAt = shortString(payload.captured_at, 'captured_at', 40);
  if (!Number.isFinite(Date.parse(capturedAt))) throw validationError('Fecha de captura inválida.');
  if (payload.accuracy != null && (typeof payload.accuracy !== 'number' || !Number.isFinite(payload.accuracy) || payload.accuracy < 0)) throw validationError('Precisión GPS inválida.');
  return {client_operation_id: operationId, partner_id: positiveId(payload.partner_id, 'partner_id'), partner_name: shortString(payload.partner_name, 'partner_name', 256), route_plan_id: positiveId(payload.route_plan_id, 'route_plan_id'), route_name: payload.route_name ?? null, company_id: positiveId(payload.company_id, 'company_id'), stop_id: positiveId(payload.stop_id, 'stop_id'), reason, comment,
    contact_person: payload.contact_person == null || payload.contact_person === '' ? null : shortString(payload.contact_person, 'contact_person', 160),
    latitude: payload.latitude, longitude: payload.longitude, accuracy: payload.accuracy ?? null, captured_at: capturedAt};
}

export function parseCustomerDeactivationResponse(value: unknown, stopId: number, allowNull = false, partnerId?: number): CustomerDeactivationSummary | null {
  if (value === null && allowNull) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationError('Respuesta de baja inválida.');
  const envelope = value as Record<string, unknown>;
  if (envelope.ok === false) throw validationError('Solicitud de baja no confirmada.');
  const wrapped = envelope.ok === true ? envelope.data : envelope;
  if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) throw validationError('Respuesta de baja inválida.');
  const dataEnvelope = wrapped as Record<string, unknown>;
  const request = 'request' in dataEnvelope ? dataEnvelope.request : dataEnvelope;
  if (request === null && allowNull) return null;
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw validationError('Solicitud de baja no confirmada.');
  const data = request as Record<string, unknown>;
  const result: CustomerDeactivationSummary = {request_id: positiveId(data.request_id, 'request_id'), stop_id: data.stop_id === undefined ? stopId : positiveId(data.stop_id, 'stop_id'), partner_id: positiveId(data.partner_id, 'partner_id'), state: shortChoice(data.state, 'state', DEACTIVATION_STATES), reason: shortChoice(data.reason, 'reason', DEACTIVATION_REASONS.map(r => r.value))};
  if (result.stop_id !== stopId || (partnerId !== undefined && result.partner_id !== partnerId)) throw validationError('La respuesta corresponde a otra parada o cliente.');
  return result;
}

export function findQueuedCustomerDeactivation<T extends {type: string; status: string; payload: Record<string, unknown>}>(queue: readonly T[], stopId: number, partnerId?: number): T | undefined {
  return queue.find(item => item.type === 'customer_deactivation_request' && item.status !== 'done'
    && (item.payload.stop_id === stopId || (partnerId != null && item.payload.partner_id === partnerId)));
}
