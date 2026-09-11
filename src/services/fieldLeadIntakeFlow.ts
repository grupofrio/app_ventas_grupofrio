import type { NewLeadForm } from './leadIntake';

export interface LeadGps { latitude: number; longitude: number; accuracy: number; timestamp: number }
export function validateLeadGps(point: LeadGps | null, now = Date.now()): LeadGps {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
    || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180
    || (point.latitude === 0 && point.longitude === 0)
    || !Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 100
    || !Number.isFinite(point.timestamp) || now - point.timestamp > 120_000 || point.timestamp > now + 5000) {
    throw new Error('Obtén una ubicación reciente y precisa estando en el negocio, o guarda el prospecto sin ubicación.');
  }
  return point;
}
export interface FieldLeadDraft {
  version: 1;
  operationId: string;
  saleOperationId: string;
  form: NewLeadForm;
  gps: LeadGps | null;
  edit?: { operationId: string; form: NewLeadForm; gps: LeadGps | null };
  phase: 'captured' | 'queued' | 'selling' | 'ready';
}
export interface FieldLeadIntakeDependencies<T> {
  uuid(): string;
  load(): Promise<FieldLeadDraft | null>;
  save(draft: FieldLeadDraft): Promise<void>;
  remove(): Promise<void>;
  enqueue(id: string, form: NewLeadForm, gps: LeadGps | null): string;
  persistQueue(): Promise<void>;
  release(id: string): void;
  process(): void;
  isOnline(): boolean;
  isDefinitiveUpdateFailure?(error: unknown): boolean;
  isDefinitiveFailure?(error: unknown, previousPhase: FieldLeadDraft['phase']): boolean;
  updateLead?(payload: {operation_id: string; lead_operation_id: string; form: NewLeadForm; gps: LeadGps | null}): Promise<void>;
  startSale(payload: { operation_id: string; lead_operation_id: string }): Promise<T>;
}
/** All retries retain the persisted operation ids, including ambiguous responses. */
export function createFieldLeadIntakeFlow<T>(deps: FieldLeadIntakeDependencies<T>) {
  let draft: FieldLeadDraft | null = null;
  let busy = false;
  async function exclusive<R>(fn: () => Promise<R>): Promise<R> {
    if (busy) throw new Error('La solicitud ya se está procesando.');
    busy = true;
    try { return await fn(); } finally { busy = false; }
  }
  return {
    getDraft: () => draft,
    async restore() { draft = await deps.load(); return draft; },
    capture(form: NewLeadForm, gps: LeadGps | null) {
      return exclusive(async () => {
        if (!draft) draft = {version: 1, operationId: deps.uuid(), saleOperationId: deps.uuid(), form: {...form}, gps, phase: 'captured'};
        if (draft.phase !== 'captured') return draft;
        await deps.save(draft); // recovery identity survives before queue insertion
        const id = deps.enqueue(draft.operationId, draft.form, draft.gps);
        await deps.persistQueue();
        deps.release(id);
        deps.process();
        const queued = {...draft, phase: 'queued' as const};
        await deps.save(queued);
        draft = queued;
        return draft;
      });
    },
    update(form: NewLeadForm, gps: LeadGps | null) {
      return exclusive(async () => {
        if (!draft || draft.phase !== 'queued' || !deps.updateLead) throw new Error('Confirma primero el estado del prospecto.');
        if (!deps.isOnline()) throw new Error('Necesitas conexión para corregir el prospecto registrado.');
        if (!draft.edit) draft = {...draft, edit: {operationId: deps.uuid(), form: {...form}, gps}};
        await deps.save(draft);
        const edit = draft.edit!;
        try {
          await deps.updateLead({operation_id: edit.operationId, lead_operation_id: draft.operationId, form: edit.form, gps: edit.gps});
        } catch (error) {
          if (deps.isDefinitiveUpdateFailure?.(error)) {
            const rejected = {...draft, edit: undefined};
            await deps.save(rejected);
            draft = rejected;
          }
          throw error;
        }
        const updated = {...draft, form: edit.form, gps: edit.gps, edit: undefined};
        await deps.save(updated);
        draft = updated;
        return draft;
      });
    },
    sell() {
      return exclusive(async () => {
        if (!draft || draft.phase === 'captured' || draft.edit) throw new Error('Primero guarda el prospecto.');
        if (!deps.isOnline()) throw new Error('Necesitas conexión para preparar el cliente y la visita de venta.');
        const previousPhase = draft.phase;
        draft = {...draft, phase: 'selling'};
        await deps.save(draft); // persist intent before any commercial mutation
        try {
          const result = await deps.startSale({operation_id: draft.saleOperationId, lead_operation_id: draft.operationId});
          draft = {...draft, phase: 'ready'};
          await deps.save(draft);
          return result;
        } catch (error) {
          if (deps.isDefinitiveFailure?.(error, previousPhase)) {
            const queued = {...draft, phase: 'queued' as const};
            await deps.save(queued);
            draft = queued;
          }
          throw error;
        }
      });
    },
    decline() {
      return exclusive(async () => {
        if (draft?.phase === 'selling' || draft?.phase === 'ready') throw new Error('Reanuda la venta para confirmar el estado de la visita antes de cerrar este paso.');
        if (draft?.phase === 'captured' || draft?.edit) throw new Error('Primero confirma el guardado del prospecto.');
        await deps.remove(); draft = null;
      });
    },
    async finishOpening() { await deps.remove(); draft = null; },
  };
}
