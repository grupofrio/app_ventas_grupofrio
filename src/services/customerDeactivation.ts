import { createCustomerDeactivationPersistence } from './customerDeactivationPersistence';
import { postRest, getRest } from './api';
import { readPhotoAsBase64 } from './camera';
import { getFieldDataSession } from './fieldDataSession';
import { loadCurrentEmployeeDayBundle } from './employeeDayBundle';
import { validationError, positiveId } from './employeeDataLogic';
import { normalizeCustomerDeactivationPayload, parseCustomerDeactivationResponse, sameCustomerDeactivationScope } from './customerDeactivationLogic';
import type { CustomerDeactivationScope, CustomerDeactivationSummary } from '../types/customerDeactivation';
export type { CustomerDeactivationSummary } from '../types/customerDeactivation';

const BASE = '/gf/logistics/api/employee/customer-deactivation';

/** Session/day binding is local metadata, never a server authority selector. */
export async function captureCustomerDeactivationScope(stopId: number): Promise<CustomerDeactivationScope> {
  positiveId(stopId, 'stop_id');
  const session = await getFieldDataSession();
  const loaded = await loadCurrentEmployeeDayBundle();
  const current = await getFieldDataSession();
  if (!session || !current || session.sessionId !== current.sessionId || session.companyId !== current.companyId || session.employeeId !== current.employeeId
    || !loaded?.access.canRunActions || loaded.record.identity.companyId !== session.companyId || loaded.record.identity.employeeId !== session.employeeId) {
    throw validationError('Renueva la sesión y el bundle del día antes de registrar la solicitud.');
  }
  const stop = loaded.record.bundle.stops.find((entry) => !!entry && typeof entry === 'object' && (entry as {id?:unknown}).id === stopId) as {customer?:{id?:unknown}} | undefined;
  if (!stop) throw validationError('La parada no pertenece al bundle vigente.');
  const partnerId = positiveId(stop.customer?.id, 'customer.id');
  return {...session, partnerId, planId: loaded.record.bundle.plan.id, operationalDate: loaded.record.bundle.operational_date};
}

export async function assertCustomerDeactivationScope(scope: CustomerDeactivationScope, stopId: number): Promise<void> {
  if (!sameCustomerDeactivationScope(scope, await captureCustomerDeactivationScope(stopId))) {
    throw validationError('Cambió la sesión, ruta o día de la solicitud.');
  }
}

export async function buildCustomerDeactivationSyncPayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = normalizeCustomerDeactivationPayload(payload);
  if (typeof payload.localPhotoUri === 'string' && payload.localPhotoUri.trim()) {
    const photo = await readPhotoAsBase64(payload.localPhotoUri);
    if (!photo) throw validationError('No se encontró la foto de evidencia.');
    body.photo_base64 = photo;
  }
  return body;
}

export async function createCustomerDeactivationRequest(payload: Record<string, unknown>): Promise<CustomerDeactivationSummary> {
  const stopId = positiveId(payload.stop_id, 'stop_id');
  const scope = payload._deactivationScope as CustomerDeactivationScope;
  await assertCustomerDeactivationScope(scope, stopId);
  if (payload.partner_id !== scope.partnerId || payload.company_id !== scope.companyId || payload.route_plan_id !== scope.planId) throw validationError('La solicitud corresponde a otro cliente, empresa o ruta.');
  const body = await buildCustomerDeactivationSyncPayload(payload);
  await assertCustomerDeactivationScope(scope, stopId);
  const response = await postRest<unknown>(`${BASE}/request`, body);
  await assertCustomerDeactivationScope(scope, stopId);
  return parseCustomerDeactivationResponse(response, stopId, false, positiveId(payload.partner_id, 'partner_id'))!;
}

/** Backend must derive customer/employee/company from the assigned stop and Bearer session. */
export async function fetchOpenCustomerDeactivation(stopId: number, partnerId: number): Promise<CustomerDeactivationSummary | null> {
  const scope = await captureCustomerDeactivationScope(stopId);
  positiveId(partnerId, 'partner_id');
  if (scope.partnerId !== partnerId) throw validationError('El cliente no corresponde a la parada vigente.');
  const response = await getRest<unknown>(`${BASE}/open?partner_id=${encodeURIComponent(String(partnerId))}`);
  await assertCustomerDeactivationScope(scope, stopId);
  return parseCustomerDeactivationResponse(response, stopId, true, partnerId);
}


async function resultPersistence() {
  const {saveEncrypted, loadEncrypted} = await import('./encryptedStore');
  return createCustomerDeactivationPersistence({getScope: captureCustomerDeactivationScope, save: saveEncrypted, load: loadEncrypted});
}

export async function persistCustomerDeactivationResult(scope: CustomerDeactivationScope, stopId: number, result: CustomerDeactivationSummary | null): Promise<void> {
  await (await resultPersistence()).save(scope, stopId, result);
}

export async function loadCustomerDeactivationResult(scope: CustomerDeactivationScope, stopId: number): Promise<CustomerDeactivationSummary | null> {
  return (await resultPersistence()).load(scope, stopId);
}
