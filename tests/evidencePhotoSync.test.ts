import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVIDENCE_PHOTO_RELEASE_ATTEMPTS,
  EVIDENCE_PHOTO_RELEASE_MS,
  PHOTO_UPLOAD_MAX_ATTEMPTS,
  alignEvidencePhotosBeforeClose,
  blockingEvidencePhotoIds,
  buildCloseDependsOn,
  buildStopImageUploadPayload,
  deadPhotoRetryBlockReason,
  describeEvidencePhotoWarning,
  evidenceTypeForImageType,
  isEvidencePhotoReleased,
  rearmDeadEvidencePhoto,
  retryCeilingForItem,
} from '../src/services/evidencePhotoSync.ts';
import { areSyncDependenciesSatisfied } from '../src/services/syncDependencies.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';

const NOW = Date.UTC(2026, 9, 7, 18, 0, 0);

function photo(partial: Partial<SyncQueueItem> & Pick<SyncQueueItem, 'id'>): SyncQueueItem {
  return {
    type: 'photo',
    payload: { stop_id: 44, localUri: 'file://point.jpg', image_type: 'visit' },
    status: 'pending',
    created_at: NOW,
    retries: 0,
    error_message: null,
    priority: 2,
    next_retry_at: null,
    ...partial,
  };
}

function checkout(partial: Partial<SyncQueueItem> & Pick<SyncQueueItem, 'id'>): SyncQueueItem {
  return {
    type: 'checkout',
    payload: { stop_id: 44 },
    status: 'pending',
    created_at: NOW,
    retries: 0,
    error_message: null,
    priority: 1,
    next_retry_at: null,
    ...partial,
  };
}

test('maps visit evidence to facade and sale evidence to delivery', () => {
  assert.equal(evidenceTypeForImageType('visit'), 'facade');
  assert.equal(evidenceTypeForImageType('sale'), 'delivery');
  assert.equal(evidenceTypeForImageType('exchange'), 'other');
});

test('checkout waits for a fresh evidence photo and proceeds after the photo is done', () => {
  const evidence = photo({ id: 'photo-1' });
  const close = checkout({ id: 'checkout-1', dependsOn: ['photo-1'] });
  const queue = [evidence, close];

  assert.equal(areSyncDependenciesSatisfied(close, queue, NOW), false);
  assert.deepEqual(blockingEvidencePhotoIds(queue, 44, NOW), ['photo-1']);

  const uploaded = [{ ...evidence, status: 'done' as const }, close];
  assert.equal(areSyncDependenciesSatisfied(close, uploaded, NOW), true);
  assert.deepEqual(blockingEvidencePhotoIds(uploaded, 44, NOW), []);
});

test('a failed photo releases checkout after N attempts or T minutes and keeps retrying', () => {
  const young = photo({ id: 'photo-1', status: 'error', retries: EVIDENCE_PHOTO_RELEASE_ATTEMPTS - 1 });
  const close = checkout({ id: 'checkout-1', dependsOn: ['photo-1'] });
  assert.equal(areSyncDependenciesSatisfied(close, [young, close], NOW), false);
  assert.equal(retryCeilingForItem(young, 3) > EVIDENCE_PHOTO_RELEASE_ATTEMPTS, true);

  const exhausted = { ...young, retries: EVIDENCE_PHOTO_RELEASE_ATTEMPTS };
  assert.equal(isEvidencePhotoReleased(exhausted, NOW), true);
  assert.equal(areSyncDependenciesSatisfied(close, [exhausted, close], NOW), true);
  assert.equal(exhausted.retries < PHOTO_UPLOAD_MAX_ATTEMPTS, true);

  const aged = photo({
    id: 'photo-1',
    status: 'pending',
    created_at: NOW - EVIDENCE_PHOTO_RELEASE_MS,
  });
  assert.equal(areSyncDependenciesSatisfied(close, [aged, close], NOW), true);
  assert.equal(
    areSyncDependenciesSatisfied(close, [{ ...aged, created_at: NOW - EVIDENCE_PHOTO_RELEASE_MS + 1 }, close], NOW),
    false,
  );
});

test('a dead photo does not keep the checkout blocked', () => {
  const evidence = photo({ id: 'photo-1', status: 'dead', error_message: 'Photo file not found' });
  const close = checkout({ id: 'checkout-1', dependsOn: ['photo-1'] });
  assert.equal(areSyncDependenciesSatisfied(close, [evidence, close], NOW), true);
});

test('a dead sale still blocks its photo', () => {
  const sale = {
    id: 'sale-1',
    type: 'sale_order' as const,
    status: 'dead' as const,
    payload: {},
    created_at: NOW,
    retries: 3,
    error_message: 'rechazo',
    priority: 1 as const,
    next_retry_at: null,
  };
  const evidence = photo({ id: 'photo-1', dependsOn: ['sale-1'] });
  assert.equal(areSyncDependenciesSatisfied(evidence, [sale, evidence], NOW), false);
});

test('queued closes are reordered so evidence photos are dependencies of the close', () => {
  const evidence = photo({ id: 'photo-1', dependsOn: ['checkout-1'] });
  const close = checkout({ id: 'checkout-1', dependsOn: ['gps-1'] });
  const other = photo({
    id: 'photo-other',
    payload: { stop_id: 99, localUri: 'file://other.jpg', image_type: 'visit' },
  });

  const aligned = alignEvidencePhotosBeforeClose([evidence, close, other], NOW);
  const alignedPhoto = aligned.find((item) => item.id === 'photo-1')!;
  const alignedClose = aligned.find((item) => item.id === 'checkout-1')!;
  const untouched = aligned.find((item) => item.id === 'photo-other')!;

  assert.equal(alignedPhoto.dependsOn, undefined);
  assert.deepEqual(alignedClose.dependsOn, ['gps-1', 'photo-1']);
  assert.equal(untouched, other);
  assert.equal(areSyncDependenciesSatisfied(alignedClose, aligned, NOW), false);
  assert.equal(areSyncDependenciesSatisfied(alignedPhoto, aligned, NOW), true);

  const again = alignEvidencePhotosBeforeClose(aligned, NOW);
  assert.equal(again, aligned);
});

test('sale dependency on a photo is preserved when the close is linked', () => {
  const evidence = photo({ id: 'photo-1', dependsOn: ['sale-1', 'checkout-1'] });
  const close = checkout({ id: 'checkout-1' });
  const aligned = alignEvidencePhotosBeforeClose([evidence, close], NOW);
  assert.deepEqual(aligned.find((item) => item.id === 'photo-1')!.dependsOn, ['sale-1']);
  assert.deepEqual(aligned.find((item) => item.id === 'checkout-1')!.dependsOn, ['photo-1']);
});

test('buildCloseDependsOn puts photos ahead of the gps dependency', () => {
  assert.deepEqual(buildCloseDependsOn(['photo-1', 'photo-2'], ['gps-1']), ['photo-1', 'photo-2', 'gps-1']);
  assert.deepEqual(buildCloseDependsOn(['photo-1'], [null, 'photo-1']), ['photo-1']);
});

test('stop image payload keeps image_type and adds evidence_type plus capture meta', () => {
  const withoutCapture = buildStopImageUploadPayload({
    stopId: 44,
    imageBase64: 'abc',
    imageType: 'visit',
  });
  assert.equal(withoutCapture.image_type, 'visit');
  assert.equal(withoutCapture.evidence_type, 'facade');
  assert.equal(withoutCapture._client_meta, undefined);

  const withCapture = buildStopImageUploadPayload({
    stopId: 44,
    imageBase64: 'abc',
    imageType: 'sale',
    latitude: 19.43,
    longitude: -99.13,
    capturedAt: '2026-10-07T18:00:00.000Z',
  });
  assert.equal(withCapture.image_type, 'sale');
  assert.equal(withCapture.evidence_type, 'delivery');
  assert.deepEqual(withCapture._client_meta, {
    x_client_event_at: '2026-10-07T18:00:00.000Z',
    latitude: 19.43,
    longitude: -99.13,
  });

  const missingGps = buildStopImageUploadPayload({
    stopId: 44,
    imageBase64: 'abc',
    imageType: 'exchange',
    latitude: 0,
    longitude: 0,
    capturedAt: '2026-10-07T18:04:00.000Z',
  });
  assert.equal(missingGps.evidence_type, 'other');
  assert.deepEqual(missingGps._client_meta, {
    x_client_event_at: '2026-10-07T18:04:00.000Z',
  });
});

test('spanish warnings distinguish pending, retrying, and dead evidence photos', () => {
  const pending = describeEvidencePhotoWarning([
    photo({ id: 'photo-1' }),
  ], 44);
  assert.equal(pending?.badge, 'Foto pendiente');
  assert.match(pending?.message ?? '', /pendiente de envío/);
  assert.match(pending?.message ?? '', /antes del check-out/);

  const retrying = describeEvidencePhotoWarning([
    photo({ id: 'photo-1', status: 'error' }),
    photo({ id: 'photo-2', status: 'pending' }),
  ], 44);
  assert.equal(retrying?.tone, 'retrying');
  assert.match(retrying?.message ?? '', /reintentar/i);

  const failed = describeEvidencePhotoWarning([
    photo({ id: 'photo-1', status: 'dead' }),
  ], 44);
  assert.equal(failed?.tone, 'failed');
  assert.equal(failed?.badge, 'Foto fallida');
  assert.match(failed?.message ?? '', /Reintentar/);
  assert.equal(describeEvidencePhotoWarning([photo({ id: 'photo-1', status: 'done' })], 44), null);
  assert.equal(describeEvidencePhotoWarning([photo({ id: 'photo-1', status: 'dead' })], 7), null);
});

test('rearming a dead photo clears the failure unless its parent operation is dead', () => {
  const evidence = photo({ id: 'photo-1', status: 'dead', retries: 12, error_message: 'parada cerrada' });
  const rearmed = rearmDeadEvidencePhoto([evidence], 'photo-1');
  assert.equal(rearmed[0].status, 'pending');
  assert.equal(rearmed[0].retries, 0);
  assert.equal(rearmed[0].error_message, null);
  assert.equal(rearmDeadEvidencePhoto(rearmed, 'photo-1'), rearmed);

  const blocked = photo({
    id: 'photo-2',
    status: 'dead',
    dependsOn: ['sale-1'],
  });
  const sale = checkout({ id: 'sale-1', type: 'sale_order', status: 'dead' });
  assert.match(deadPhotoRetryBlockReason(blocked, [blocked, sale]) ?? '', /operación que falló/);
  assert.equal(deadPhotoRetryBlockReason(evidence, [evidence]), null);
});
