/**
 * Seller notes that belong on the crm.lead, not only on the route stop.
 *
 * The visit close (checkout) stays independent: this item is queued beside
 * it. A 404 from the parallel lead/note endpoint stays retryable and must
 * not mark the note dead or fail the checkout.
 */

import type { SyncQueueItem } from '../types/sync.ts';
import { isRetryableSyncErrorMessage } from '../utils/syncFailure.ts';

export const LEAD_NOTE_PATH = 'gf/logistics/api/employee/lead/note';

export interface LeadNoteWireBody {
  lead_id: number;
  note: string;
  stop_id?: number;
}

export interface PlanLeadNoteInput {
  /** Stable scope so checkout's two paths (online and queued) share one item. */
  scopeId: string;
  note: string;
  stopId: number;
  entityType?: 'customer' | 'lead' | null;
  leadId?: number | null;
  pendingLeadOperationId?: string | null;
}

export interface PlannedLeadNote {
  operationId: string;
  payload: Record<string, unknown>;
  dependsOn?: string[];
}

export type LeadNoteFailureAction = 'hold_missing_endpoint' | 'retry' | 'dead';

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function hashLeadNote(note: string): string {
  let hash = 0;
  for (let index = 0; index < note.length; index += 1) {
    hash = (Math.imul(hash, 31) + note.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

/**
 * Queue a note only for a lead or a stop that already has a lead id.
 * Customers are skipped. A virtual prospect has a negative stop id: that id
 * is kept locally and is not sent as stop_id. Without a lead id, the item
 * waits on the field-lead create that will produce one.
 */
export function planLeadNote(input: PlanLeadNoteInput): PlannedLeadNote | null {
  const note = input.note.trim();
  const scopeId = input.scopeId.trim();
  if (!note || !scopeId) return null;

  const leadId = positiveId(input.leadId);
  const pendingLeadOperationId = (input.pendingLeadOperationId ?? '').trim();
  if (input.entityType === 'customer') return null;
  const isLead = input.entityType === 'lead' || leadId !== null;
  if (!isLead) return null;
  if (leadId === null && !pendingLeadOperationId) return null;

  const payload: Record<string, unknown> = {
    lead_id: leadId,
    note,
    local_stop_id: input.stopId,
  };
  const routeStopId = positiveId(input.stopId);
  if (routeStopId !== null) payload.stop_id = routeStopId;
  if (leadId === null) payload.pending_lead_operation_id = pendingLeadOperationId;

  return {
    operationId: `lead-note:${scopeId}`,
    payload,
    dependsOn: leadId === null ? [pendingLeadOperationId] : undefined,
  };
}

/** Body for POST lead/note. Internal queue fields never leave the device. */
export function buildLeadNoteRequest(payload: Record<string, unknown>): LeadNoteWireBody | null {
  const leadId = positiveId(payload.lead_id);
  const note = typeof payload.note === 'string' ? payload.note.trim() : '';
  if (leadId === null || !note) return null;
  const body: LeadNoteWireBody = { lead_id: leadId, note };
  const stopId = positiveId(payload.stop_id);
  if (stopId !== null) body.stop_id = stopId;
  return body;
}

export function isLeadNoteEndpointMissing(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'httpStatus' in error) {
    if ((error as { httpStatus?: unknown }).httpStatus === 404) return true;
  }
  const message = error instanceof Error ? error.message : '';
  return /^HTTP 404\b/i.test(message.trim());
}

export function shouldRetryLeadNoteError(error: unknown): boolean {
  if (isLeadNoteEndpointMissing(error)) return true;
  const message = error instanceof Error ? error.message : 'Sync error';
  return isRetryableSyncErrorMessage(message);
}

/**
 * 404 means the gf endpoint is not deployed yet. The same item stays eligible
 * after the normal retry ceiling; the 90-day reconciliation cutoff still applies.
 */
export function decideLeadNoteFailure(
  error: unknown,
  retriesAfterAttempt: number,
  maxRetries: number,
): LeadNoteFailureAction {
  if (isLeadNoteEndpointMissing(error)) return 'hold_missing_endpoint';
  if (!shouldRetryLeadNoteError(error) || retriesAfterAttempt >= maxRetries) return 'dead';
  return 'retry';
}

export function capLeadNoteRetries<T extends { id: string; retries: number }>(
  queue: T[],
  id: string,
  maxRetries: number,
): T[] {
  const cap = Math.max(0, maxRetries - 1);
  let changed = false;
  const next = queue.map((item) => {
    if (item.id !== id || item.retries < maxRetries) return item;
    changed = true;
    return { ...item, retries: cap };
  });
  return changed ? next : queue;
}

/** Fill lead_id once the field-lead create that this note waits on succeeds. */
export function assignCreatedLeadToNoteItems(
  queue: SyncQueueItem[],
  pendingLeadOperationId: string,
  leadId: number,
): SyncQueueItem[] {
  if (!pendingLeadOperationId || !(leadId > 0)) return queue;
  let changed = false;
  const next = queue.map((item) => {
    if (item.type !== 'lead_note') return item;
    if (item.payload.pending_lead_operation_id !== pendingLeadOperationId) return item;
    if (item.payload.lead_id === leadId) return item;
    changed = true;
    return {
      ...item,
      payload: {
        ...item.payload,
        lead_id: leadId,
      },
    };
  });
  return changed ? next : queue;
}
