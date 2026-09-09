import * as Location from 'expo-location';
import { loadCurrentEmployeeDayBundle } from './employeeDayBundle';
import { getFieldDataSession } from './fieldDataSession';
import { loadEncrypted, saveEncrypted, removeEncrypted } from './encryptedStore';
import { createFieldLeadIntakeFlow, validateLeadGps, type FieldLeadDraft, type LeadGps } from './fieldLeadIntakeFlow';
import { buildProspectionPayload } from './leadIntake';
import { useSyncStore } from '../stores/useSyncStore';
import { useRouteStore } from '../stores/useRouteStore';
import { useVisitStore, persistCurrentVisit } from '../stores/useVisitStore';
import { createUuidV4 } from '../utils/clientEvent';
import { getApiErrorCode } from './apiRequestError';
import { postRest } from './api';
import { normalizePlanStopPayload } from './planStopPayload';
import { storeSaveStrict, STORAGE_KEYS } from '../persistence/storage';
import type { GFStop } from '../types/plan';

const KEY = 'field-lead-intake:v1';
export interface LeadSaleStart { lead_id: number; partner_id: number; visit_id: number; stop: GFStop }

export async function captureLeadGps(): Promise<LeadGps> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Permite la ubicación para usar el GPS del negocio. También puedes guardar el prospecto sin ubicación.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({accuracy: Location.Accuracy.High}),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('El GPS tardó demasiado. Vuelve a obtener la ubicación.')), 15_000); }),
    ]);
    return validateLeadGps({latitude: position.coords.latitude, longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? Infinity, timestamp: position.timestamp});
  } finally { if (timer) clearTimeout(timer); }
}

function assertAvailableVisit(operationId: string) {
  const visit = useVisitStore.getState();
  if (visit.phase !== 'idle' && visit.phase !== 'checked_out' && visit.currentStop?._leadSaleOperationId !== operationId) {
    throw Object.assign(new Error('Termina o continúa la visita actual antes de abrir la venta de este prospecto.'), {code:'lead_sale_local_guard'});
  }
}
export async function createNativeFieldLeadIntake() {
  const session = await getFieldDataSession();
  if (!session) throw new Error('Inicia sesión antes de registrar prospectos.');
  async function assertSession() {
    const current = await getFieldDataSession();
    if (!current || current.sessionId !== session!.sessionId || current.employeeId !== session!.employeeId || current.companyId !== session!.companyId) {
      throw new Error('Cambió la sesión. Vuelve a abrir Nuevo Prospecto.');
    }
  }
  const flow = createFieldLeadIntakeFlow<LeadSaleStart>({
    uuid: createUuidV4,
    async load() {
      await assertSession();
      const draft = await loadEncrypted<FieldLeadDraft>(session, KEY);
      await assertSession();
      if (draft && (draft.version !== 1 || !draft.operationId || !draft.saleOperationId || !draft.form || !['captured','queued','selling','ready'].includes(draft.phase))) {
        throw new Error('No se pudo leer el alta pendiente. No vuelvas a crear el prospecto hasta revisar el registro.');
      }
      return draft;
    },
    async save(draft) { await assertSession(); await saveEncrypted(session, KEY, draft); await assertSession(); },
    async remove() { await assertSession(); await removeEncrypted(session, KEY); },
    enqueue: (id, form, gps) => useSyncStore.getState().enqueue('prospection', buildProspectionPayload(form, gps ?? {}), {operationId: id, holdProcessing: true}),
    persistQueue: () => useSyncStore.getState().persistQueue(),
    release: id => useSyncStore.getState().releaseProcessingHolds([id]),
    process: () => { void useSyncStore.getState().processQueue(); },
    isOnline: () => useSyncStore.getState().isOnline,
    isDefinitiveUpdateFailure: error => ['validation_error','access_denied'].includes(getApiErrorCode(error) ?? ''),
    isDefinitiveFailure: (error, previousPhase) => {
      const code = getApiErrorCode(error);
      if (code === 'lead_sale_local_guard') return previousPhase === 'queued';
      return ['review_required_duplicate', 'lead_data_incomplete', 'lead_sale_visit_closed'].includes(code ?? '');
    },
    async updateLead(payload) {
      await assertSession();
      const response = await postRest<any>('gf/logistics/api/employee/lead/intake-update', {
        ...buildProspectionPayload(payload.form, payload.gps ?? {}),
        clear_location: payload.gps === null, operation_id: payload.operation_id, lead_operation_id: payload.lead_operation_id,
      });
      await assertSession();
      const id = (response?.data ?? response)?.lead_id;
      if (!Number.isInteger(id) || id <= 0) throw new Error('No se confirmó la corrección. Reintenta la misma solicitud.');
    },
    async startSale(payload) {
      await assertSession();
      assertAvailableVisit(payload.operation_id);
      const bundle = await loadCurrentEmployeeDayBundle();
      if (!bundle?.access.canRunActions) throw Object.assign(new Error('Prepara los datos del día antes de abrir la venta.'), {code:'lead_sale_local_guard'});
      await assertSession();
      const response = await postRest<any>('gf/logistics/api/employee/lead/start-sale', payload);
      await assertSession();
      const data = response?.data ?? response;
      for (const key of ['lead_id', 'partner_id', 'visit_id']) {
        if (!Number.isInteger(data?.[key]) || data[key] <= 0) throw new Error('No se pudo confirmar el cliente y la visita. Reintenta esta misma operación.');
      }
      if (!Number.isInteger(data.stop?.id) || data.stop.id <= 0 || data.stop.customer_id !== data.partner_id) {
        throw new Error('La respuesta no confirmó la parada del cliente. Reintenta.');
      }
      if (!Number.isFinite(data.stop.customer_latitude) || !Number.isFinite(data.stop.customer_longitude)
        || (data.stop.customer_latitude === 0 && data.stop.customer_longitude === 0)) {
        throw new Error('No se confirmó la ubicación del cliente. Reintenta esta misma operación.');
      }
      return {...data, stop: normalizePlanStopPayload(data.stop)} as LeadSaleStart;
    },
  });
  return {
    flow,
    async confirmRegistered(operationId: string): Promise<boolean> {
      await assertSession();
      const response = await postRest<any>('gf/logistics/api/employee/lead/creation-status', {lead_operation_id: operationId});
      await assertSession();
      const id = (response?.data ?? response)?.lead_id;
      return Number.isInteger(id) && id > 0;
    },
    async openSale(result: LeadSaleStart, operationId: string): Promise<number> {
      await assertSession();
      assertAvailableVisit(operationId);
      const route = useRouteStore.getState();
      const server = result.stop;
      const id = route.addVirtualStop(result.partner_id, server.customer_name, {
        entityType: 'lead', leadId: result.lead_id, partnerId: result.partner_id,
        offrouteVisitId: result.visit_id, pricelistId: server._pricelistId, pricelistName: server._pricelistName,
        customerLatitude: server.customer_latitude, customerLongitude: server.customer_longitude,
        street: server.street, city: server.city,
      });
      const previous = useRouteStore.getState().stops.find(stop => stop.id === id)!;
      const stop: GFStop = {...previous, ...server, id, _isOffroute: true, _offrouteVisitId: result.visit_id,
        _leadSaleOperationId: operationId, _virtualCreatedAt: previous._virtualCreatedAt, state: 'in_progress'};
      route.patchStop(id, stop);
      await storeSaveStrict(STORAGE_KEYS.STOPS, useRouteStore.getState().stops);
      await assertSession();
      const visit = useVisitStore.getState();
      // A retry while the cart is already open must preserve its products and sale lock.
      if (visit.currentStop?._leadSaleOperationId !== operationId) {
        assertAvailableVisit(operationId);
        visit.resetVisit();
        visit.startVisit(stop, stop.customer_latitude!, stop.customer_longitude!);
        visit.setOffrouteVisitId(result.visit_id);
      }
      await persistCurrentVisit();
      await assertSession();
      await flow.finishOpening();
      return id;
    },
  };
}
