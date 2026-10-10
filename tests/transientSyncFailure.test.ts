import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import { rearmDeadBusinessItem, deadBusinessRetryBlockReason } from '../src/services/deadBusinessRetry.ts';
import { MANUAL_RECONCILIATION_REQUIRED_MESSAGE } from '../src/services/syncRetryDecision.ts';
import {
  decideBusinessFailureDisposition,
  isTransientSyncFailure,
  reviveTransientDeadItems,
  transientBackoffMs,
  TRANSIENT_BACKOFF_CAP_MS,
} from '../src/services/transientSyncFailure.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';

const root = resolve();

function item(partial: Partial<SyncQueueItem> & Pick<SyncQueueItem, 'id' | 'type'>): SyncQueueItem {
  return {
    payload: { _operationId: partial.id },
    status: 'dead',
    created_at: 1,
    retries: 3,
    error_message: 'HTTP 503',
    priority: 1,
    next_retry_at: null,
    ...partial,
  };
}

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { httpStatus: number; responseReceived: boolean };
  error.httpStatus = status;
  error.responseReceived = true;
  return error;
}

test('5xx, 408, 429, timeouts and transport errors are transient', () => {
  assert.equal(isTransientSyncFailure(httpError(503, 'Service Unavailable')), true);
  assert.equal(isTransientSyncFailure(httpError(500, 'Error interno en API logística.')), true);
  assert.equal(isTransientSyncFailure(httpError(408, 'Request Timeout')), true);
  assert.equal(isTransientSyncFailure(httpError(429, 'Too Many Requests')), true);
  const transport = new Error('Network request failed') as Error & { responseReceived: boolean };
  transport.responseReceived = false;
  assert.equal(isTransientSyncFailure(transport), true);
  assert.equal(isTransientSyncFailure(new Error('timed out')), true);
  assert.equal(isTransientSyncFailure('HTTP 503'), true);
});

test('real 4xx business rejections are not transient', () => {
  assert.equal(isTransientSyncFailure(httpError(400, 'validation_error')), false);
  assert.equal(isTransientSyncFailure(httpError(404, 'HTTP 404')), false);
  assert.equal(isTransientSyncFailure(httpError(422, 'insufficient_stock')), false);
  assert.equal(isTransientSyncFailure(new Error('Estás fuera de radio para check-in')), false);
  assert.equal(isTransientSyncFailure(new Error('HTTP 422')), false);
});

test('a prospect keeps retrying through a long 503 and a 4xx sale still dies', () => {
  const outage = httpError(503, 'Service Unavailable');
  assert.equal(decideBusinessFailureDisposition({
    type: 'prospection',
    error: outage,
    retriesAfterAttempt: 4,
    attemptLimit: 3,
    shouldRetry: true,
  }), 'retry');
  assert.equal(decideBusinessFailureDisposition({
    type: 'sale_order',
    error: httpError(409, 'insufficient_stock'),
    retriesAfterAttempt: 1,
    attemptLimit: 3,
    shouldRetry: false,
  }), 'dead');
  assert.equal(decideBusinessFailureDisposition({
    type: 'photo',
    error: outage,
    retriesAfterAttempt: 20,
    attemptLimit: 12,
    shouldRetry: true,
  }), 'retry');
  assert.equal(decideBusinessFailureDisposition({
    type: 'gps',
    error: outage,
    retriesAfterAttempt: 3,
    attemptLimit: 3,
    shouldRetry: true,
  }), 'dead');
  assert.equal(decideBusinessFailureDisposition({
    type: 'checkin',
    error: new Error('timed out'),
    retriesAfterAttempt: 8,
    attemptLimit: 3,
    shouldRetry: true,
  }), 'retry');
});

test('startup moves a dead 503 prospect back to pending and keeps its operation id', () => {
  const prospect = item({
    id: 'lead-1',
    type: 'prospection',
    payload: { _operationId: 'lead-1', name: 'Ana', phone: '5512345678' },
    error_message: 'HTTP 503',
  });
  const sale = item({
    id: 'sale-1',
    type: 'sale_order',
    error_message: 'insufficient_stock',
    payload: { _operationId: 'sale-1', operation_id: 'sale-1' },
  });
  const blocked = item({
    id: 'photo-1',
    type: 'photo',
    error_message: 'No enviada: depende de una operación que falló',
    dependsOn: ['sale-1'],
  });
  const expired = item({
    id: 'pay-1',
    type: 'payment',
    error_message: MANUAL_RECONCILIATION_REQUIRED_MESSAGE,
  });
  const gps = item({ id: 'gps-1', type: 'gps', priority: 3, error_message: 'HTTP 503' });
  const review = item({
    id: 'cons-1',
    type: 'consignment_close',
    error_message: 'HTTP 503',
    payload: {
      _operationId: 'cons-1',
      _consignmentPhysicalDeliveryReviewRequired: true,
    },
  });
  const body = item({
    id: 'lead-2',
    type: 'prospection',
    error_message: '503 Service Unavailable',
    payload: { _operationId: 'lead-2' },
  });

  const revived = reviveTransientDeadItems([prospect, sale, blocked, expired, gps, review, body]);
  assert.deepEqual(revived.revivedIds, ['lead-1', 'lead-2']);
  const lead = revived.queue.find((row) => row.id === 'lead-1');
  assert.equal(lead?.status, 'pending');
  assert.equal(lead?.payload._operationId, 'lead-1');
  assert.equal(lead?.payload.name, 'Ana');
  assert.equal(revived.queue.find((row) => row.id === 'sale-1')?.status, 'dead');
  assert.equal(revived.queue.find((row) => row.id === 'photo-1')?.status, 'dead');
  assert.equal(revived.queue.find((row) => row.id === 'pay-1')?.status, 'dead');
  assert.equal(revived.queue.find((row) => row.id === 'gps-1')?.status, 'dead');
  assert.equal(revived.queue.find((row) => row.id === 'cons-1')?.status, 'dead');
  assert.equal(revived.queue.find((row) => row.id === 'lead-2')?.payload._operationId, 'lead-2');
});

test('manual retry rearms a rejected prospect without minting a new id', () => {
  const prospect = item({
    id: 'lead-9',
    type: 'prospection',
    error_message: 'HTTP 422',
    payload: { _operationId: 'lead-9', name: 'Luz' },
  });
  assert.equal(deadBusinessRetryBlockReason(prospect, [prospect]), null);
  const next = rearmDeadBusinessItem([prospect], 'lead-9');
  assert.equal(next[0].id, 'lead-9');
  assert.equal(next[0].status, 'pending');
  assert.equal(next[0].payload._operationId, 'lead-9');
  assert.equal(next[0].retries, 0);

  const child = item({
    id: 'photo-9',
    type: 'photo',
    dependsOn: ['sale-9'],
    error_message: 'Foto no enviada porque la venta falló',
  });
  const parent = item({ id: 'sale-9', type: 'sale_order', error_message: 'insufficient_stock' });
  assert.match(deadBusinessRetryBlockReason(child, [child, parent]) ?? '', /Reintenta/);
});

test('backoff grows and then stays capped at 5 minutes', () => {
  assert.equal(transientBackoffMs(0, () => 0.5), 2_000);
  assert.equal(transientBackoffMs(1, () => 0.5), 8_000);
  assert.equal(transientBackoffMs(2, () => 0.5), 30_000);
  assert.equal(transientBackoffMs(3, () => 0.5), 120_000);
  assert.equal(transientBackoffMs(4, () => 0.5), TRANSIENT_BACKOFF_CAP_MS);
  assert.equal(transientBackoffMs(40, () => 1), TRANSIENT_BACKOFF_CAP_MS);
  assert.ok(transientBackoffMs(40, () => 0) <= TRANSIENT_BACKOFF_CAP_MS);
});

test('queue, header and check-in keep transient work alive on the same id', () => {
  const store = readFileSync(resolve(root, 'src/stores/useSyncStore.ts'), 'utf8');
  const bar = readFileSync(resolve(root, 'src/components/ui/SyncBar.tsx'), 'utf8');
  const screen = readFileSync(resolve(root, 'app/sync.tsx'), 'utf8');
  const checkin = readFileSync(resolve(root, 'src/services/gfLogistics.ts'), 'utf8');

  const decision = store.indexOf('decideBusinessFailureDisposition({');
  const terminal = store.indexOf("else if (!shouldRetry || newRetries >= attemptLimit)");
  assert.ok(decision > 0 && terminal > decision);
  assert.match(store, /reviveTransientDeadItems\(droppedGps\.queue\)/);
  assert.match(store, /isEligibleNow\(item, now, MAX_RETRIES\)/);
  assert.match(store, /checkinOperationId/);
  assert.match(store, /const MAX_RETRIES = 3/);

  const synced = bar.indexOf('Datos sincronizados');
  const failed = bar.indexOf('errorCount + deadCount');
  assert.ok(failed > 0 && synced > failed);
  assert.match(bar, /hasUserVisibleSyncing\(queue\)/);
  assert.doesNotMatch(bar, /const \{[^}]*isSyncing[^}]*\} = useSyncStore\(\)/);

  assert.match(screen, /retryDeadItem\(item\.id\)/);
  assert.match(screen, /onRetryDead=\{\(\) =>/);
  assert.doesNotMatch(screen, /onRetryDead=\{item\.type === 'photo'/);
  assert.match(screen, /label="Reintentar"/);

  const checkInFn = checkin.slice(checkin.indexOf('export async function checkIn'));
  assert.match(checkInFn, /operationId/);
  assert.match(checkInFn, /operation_id/);
});
