import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import {
  assignCreatedLeadToNoteItems,
  buildLeadNoteRequest,
  capLeadNoteRetries,
  decideLeadNoteFailure,
  planLeadNote,
} from '../src/services/leadNote.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';

const REPO_ROOT = resolve();

test('a virtual prospect note omits the negative stop id and waits for the lead create', () => {
  const plan = planLeadNote({
    scopeId: 'checkout-op-1',
    note: '  no estaba el encargado  ',
    stopId: -42,
    entityType: 'lead',
    leadId: null,
    pendingLeadOperationId: 'lead-create-9',
  });

  assert.ok(plan);
  assert.equal(plan.operationId, 'lead-note:checkout-op-1');
  assert.deepEqual(plan.dependsOn, ['lead-create-9']);
  assert.equal(plan.payload.note, 'no estaba el encargado');
  assert.equal(plan.payload.lead_id, null);
  assert.equal(plan.payload.local_stop_id, -42);
  assert.equal('stop_id' in plan.payload, false);
  assert.equal(plan.dependsOn?.includes('checkout-op-1'), false);

  assert.equal(buildLeadNoteRequest(plan.payload), null);
});

test('a route lead sends lead_id and the positive stop, and a customer does not queue', () => {
  const plan = planLeadNote({
    scopeId: 'checkout-op-2',
    note: 'Cerrado sin venta',
    stopId: 88,
    entityType: 'lead',
    leadId: 15,
    pendingLeadOperationId: 'ignored-once-lead-exists',
  });

  assert.ok(plan);
  assert.equal(plan.dependsOn, undefined);
  assert.deepEqual(buildLeadNoteRequest({
    ...plan.payload,
    _operationId: plan.operationId,
    pending_lead_operation_id: 'should-not-leave',
    local_stop_id: -1,
  }), {
    lead_id: 15,
    note: 'Cerrado sin venta',
    stop_id: 88,
  });

  assert.equal(planLeadNote({
    scopeId: 'checkout-op-3',
    note: 'nota de cliente',
    stopId: 88,
    entityType: 'customer',
    leadId: 15,
  }), null);
  assert.equal(planLeadNote({
    scopeId: 'checkout-op-4',
    note: '   ',
    stopId: -7,
    entityType: 'lead',
    pendingLeadOperationId: 'lead-create-9',
  }), null);
  assert.equal(planLeadNote({
    scopeId: 'checkout-op-5',
    note: 'sin lead todavía',
    stopId: -7,
    entityType: 'lead',
    leadId: null,
    pendingLeadOperationId: '',
  }), null);
});

test('a created lead id is copied onto the waiting note', () => {
  const note = queueItem('lead-note:checkout-op-1', 'lead_note', {
    lead_id: null,
    note: 'comentario',
    pending_lead_operation_id: 'lead-create-9',
    local_stop_id: -42,
  });
  const other = queueItem('other-note', 'lead_note', {
    lead_id: null,
    note: 'otro',
    pending_lead_operation_id: 'someone-else',
  });

  const updated = assignCreatedLeadToNoteItems([note, other], 'lead-create-9', 501);
  assert.equal(updated[0].payload.lead_id, 501);
  assert.equal(updated[1].payload.lead_id, null);
  assert.deepEqual(buildLeadNoteRequest(updated[0].payload), {
    lead_id: 501,
    note: 'comentario',
  });
});

test('HTTP 404 stays retryable past the normal ceiling and other errors do not', () => {
  const missing = Object.assign(new Error('HTTP 404'), { httpStatus: 404 });
  const network = new Error('Network request failed');
  const rejected = Object.assign(new Error('HTTP 422'), { httpStatus: 422 });

  assert.equal(decideLeadNoteFailure(missing, 1, 3), 'hold_missing_endpoint');
  assert.equal(decideLeadNoteFailure(missing, 3, 3), 'hold_missing_endpoint');
  assert.equal(decideLeadNoteFailure(missing, 99, 3), 'hold_missing_endpoint');
  assert.equal(decideLeadNoteFailure(new Error('HTTP 404'), 4, 3), 'hold_missing_endpoint');
  assert.equal(decideLeadNoteFailure(network, 1, 3), 'retry');
  assert.equal(decideLeadNoteFailure(network, 3, 3), 'dead');
  assert.equal(decideLeadNoteFailure(rejected, 1, 3), 'dead');

  const held = capLeadNoteRetries([
    { id: 'lead-note:checkout-op-1', retries: 3 },
    { id: 'other', retries: 3 },
  ], 'lead-note:checkout-op-1', 3);
  assert.equal(held[0].retries, 2);
  assert.equal(held[1].retries, 3);
});

test('checkout capture and the sync queue keep a missing lead note retryable', () => {
  const syncStore = readFileSync(resolve(REPO_ROOT, 'src/stores/useSyncStore.ts'), 'utf8');
  const checkout = readFileSync(resolve(REPO_ROOT, 'src/services/gfLogistics.ts'), 'utf8');
  const catchStart = syncStore.indexOf("const msg = error instanceof Error ? error.message : 'Sync error';");
  const deadBranch = syncStore.indexOf('get().markDead(item.id, msg, newRetries);', catchStart);
  const hold = syncStore.indexOf('isLeadNoteEndpointMissing(error)', catchStart);

  assert.ok(hold > catchStart && hold < deadBranch);
  assert.match(syncStore, /case 'lead_note':/);
  assert.match(syncStore, /assignCreatedLeadToNoteItems/);
  assert.match(syncStore, /capLeadNoteRetries\(get\(\)\.queue, item\.id, MAX_RETRIES\)/);
  assert.match(checkout, /captureCheckoutLeadNote/);
  const checkoutFn = checkout.slice(
    checkout.indexOf('export async function checkOut('),
    checkout.indexOf('export async function getStopLines('),
  );
  assert.match(checkoutFn, /captureCheckoutLeadNote/);
  assert.match(checkoutFn, /catch/);
});

function queueItem(
  id: string,
  type: SyncQueueItem['type'],
  payload: Record<string, unknown>,
): SyncQueueItem {
  return {
    id,
    type,
    payload,
    status: 'pending',
    created_at: 1,
    retries: 0,
    error_message: null,
    priority: 1,
    next_retry_at: null,
  };
}
