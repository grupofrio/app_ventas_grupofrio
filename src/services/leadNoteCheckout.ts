import { useRouteStore } from '../stores/useRouteStore.ts';
import { planLeadNote, type PlannedLeadNote } from './leadNote.ts';

/**
 * Reads the stop while it is still on the route. Virtual prospects use a
 * negative id and may only have a pending lead-create operation.
 */
export function planCheckoutLeadNote(input: {
  checkoutOperationId: string;
  stopId: number;
  notes?: string | null;
}): PlannedLeadNote | null {
  const stop = useRouteStore.getState().stops.find((item) => item.id === input.stopId);
  return planLeadNote({
    scopeId: input.checkoutOperationId,
    note: input.notes ?? '',
    stopId: input.stopId,
    entityType: stop?._entityType ?? null,
    leadId: stop?._leadId ?? null,
    pendingLeadOperationId: stop?._pendingLeadOperationId ?? null,
  });
}
