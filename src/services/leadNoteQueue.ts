import { useSyncStore } from '../stores/useSyncStore.ts';
import { hashLeadNote, planLeadNote, type PlannedLeadNote } from './leadNote.ts';
import { planCheckoutLeadNote } from './leadNoteCheckout.ts';

function enqueuePlannedLeadNote(plan: PlannedLeadNote | null): void {
  if (!plan) return;
  useSyncStore.getState().enqueue('lead_note', plan.payload, {
    operationId: plan.operationId,
    ...(plan.dependsOn && plan.dependsOn.length > 0 ? { dependsOn: plan.dependsOn } : {}),
  });
}

/**
 * Online checkout awaits this before the caller drops a virtual stop.
 * The caller must catch: a note failure must not reject the visit close.
 */
export async function captureCheckoutLeadNote(input: {
  checkoutOperationId: string;
  stopId: number;
  notes?: string | null;
}): Promise<void> {
  enqueuePlannedLeadNote(planCheckoutLeadNote(input));
}

/** Postvisit / convert notes. A negative prospect id is a valid local stop. */
export function queueLeadVisitNote(input: {
  stopId: number;
  note: string;
  entityType?: 'customer' | 'lead' | null;
  leadId?: number | null;
  pendingLeadOperationId?: string | null;
}): void {
  try {
    const note = input.note.trim();
    enqueuePlannedLeadNote(planLeadNote({
      scopeId: `postvisit:${input.stopId}:${hashLeadNote(note)}`,
      note,
      stopId: input.stopId,
      entityType: input.entityType ?? null,
      leadId: input.leadId ?? null,
      pendingLeadOperationId: input.pendingLeadOperationId ?? null,
    }));
  } catch {
    // Saving or converting the visit must succeed even if the note cannot be queued.
  }
}
