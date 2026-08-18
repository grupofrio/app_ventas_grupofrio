import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_NO_SALE_REASON_CATALOG,
  validateNoSaleCapture,
} from '../src/services/noSaleValidation.ts';
import {
  createOpenNoSaleIntent,
  noSaleIntentRecordKey,
  parseNoSaleIntent,
  assertNoSaleIntentCanOpen,
  resolveNoSaleOperationId,
  withNoSaleIntentState,
} from '../src/services/noSaleOperationPersistenceLogic.ts';

describe('canonical no-sale catalog (fallback labels, not authority)', () => {
  it('matches approved order and Spanish labels', () => {
    assert.equal(CANONICAL_NO_SALE_REASON_CATALOG.length, 10);
    const codes = CANONICAL_NO_SALE_REASON_CATALOG.map((r) => r.code);
    assert.deepEqual(codes, [
      'closed',
      'has_stock',
      'limited_space',
      'competitor',
      'no_contact',
      'no_display',
      'freezer_broken',
      'no_freezer',
      'supervisor_requested',
      'other',
    ]);
    assert.equal(CANONICAL_NO_SALE_REASON_CATALOG[0].name, 'Cliente cerrado');
    assert.equal(CANONICAL_NO_SALE_REASON_CATALOG[3].name, 'Lo surtió un competidor');
    assert.equal(CANONICAL_NO_SALE_REASON_CATALOG[8].name, 'Quiere hablar con un supervisor');
    assert.equal(CANONICAL_NO_SALE_REASON_CATALOG[9].name, 'Otro');
  });
});

describe('no-sale conditional validation', () => {
  const base = { photoTaken: true, competitorCatalogAvailable: true };

  it('allows closed/has_stock/limited_space/no_contact/display/freezer without notes', () => {
    for (const code of [
      'closed', 'has_stock', 'limited_space', 'no_contact',
      'no_display', 'freezer_broken', 'no_freezer',
    ]) {
      assert.equal(
        validateNoSaleCapture({ ...base, reasonCode: code, notes: '', competitor: null }),
        null,
      );
    }
  });

  it('requires competitor when catalog available', () => {
    assert.equal(
      validateNoSaleCapture({
        ...base,
        reasonCode: 'competitor',
        notes: '',
        competitor: null,
      }),
      'competitor_required',
    );
    assert.equal(
      validateNoSaleCapture({
        ...base,
        reasonCode: 'competitor',
        notes: 'opcional',
        competitor: 'Crystal',
      }),
      null,
    );
  });

  it('requires typed competitor when catalog unavailable', () => {
    assert.equal(
      validateNoSaleCapture({
        photoTaken: true,
        competitorCatalogAvailable: false,
        reasonCode: 'competitor',
        notes: '',
        competitor: 'Marca X',
      }),
      null,
    );
    assert.equal(
      validateNoSaleCapture({
        photoTaken: true,
        competitorCatalogAvailable: false,
        reasonCode: 'competitor',
        notes: 'Lo surtió Holanda',
        competitor: null,
      }),
      'competitor_required',
    );
  });

  it('requires notes for other and supervisor_requested', () => {
    assert.equal(
      validateNoSaleCapture({ ...base, reasonCode: 'other', notes: '', competitor: null }),
      'notes_required_other',
    );
    assert.equal(
      validateNoSaleCapture({ ...base, reasonCode: 'other', notes: 'sin efectivo', competitor: null }),
      null,
    );
    assert.equal(
      validateNoSaleCapture({
        ...base,
        reasonCode: 'supervisor_requested',
        notes: '',
        competitor: null,
      }),
      'notes_required_supervisor',
    );
    assert.equal(
      validateNoSaleCapture({
        ...base,
        reasonCode: 'supervisor_requested',
        notes: 'Quiere renegociar precio',
        competitor: null,
      }),
      null,
    );
  });

  it('requires photo', () => {
    assert.equal(
      validateNoSaleCapture({
        ...base,
        photoTaken: false,
        reasonCode: 'closed',
        notes: '',
        competitor: null,
      }),
      'photo_required',
    );
  });
});

describe('no-sale durable operation identity', () => {
  const OP = '11111111-1111-4111-8111-111111111111';

  it('keys intent by day/plan/stop', () => {
    assert.equal(
      noSaleIntentRecordKey({ operationalDate: '2026-08-18', planId: 9, stopId: 42 }),
      'nosale:intent:v1:2026-08-18:9:42',
    );
  });

  it('reuses open intent operation_id (kill before network)', () => {
    const existing = createOpenNoSaleIntent({
      stopId: 42,
      planId: 9,
      operationalDate: '2026-08-18',
      reasonCode: 'closed',
      reasonId: 1,
      notes: '',
      competitor: null,
      photoUris: [],
      operationId: OP,
    });
    const resolved = resolveNoSaleOperationId({
      existing,
      stopId: 42,
      reasonCode: 'closed',
    });
    assert.equal(resolved.operationId, OP);
    assert.equal(resolved.reuse, true);
  });

  it('mints new uuid only after terminal retirement', () => {
    const completed = withNoSaleIntentState(
      createOpenNoSaleIntent({
        stopId: 42,
        planId: 9,
        operationalDate: '2026-08-18',
        reasonCode: 'closed',
        reasonId: 1,
        notes: '',
        competitor: null,
        photoUris: [],
        operationId: OP,
      }),
      'completed',
    );
    const resolved = resolveNoSaleOperationId({
      existing: completed,
      stopId: 42,
      reasonCode: 'closed',
    });
    assert.notEqual(resolved.operationId, OP);
    assert.equal(resolved.reuse, false);
  });

  it('round-trips parse of open intent', () => {
    const intent = createOpenNoSaleIntent({
      stopId: 7,
      planId: null,
      operationalDate: null,
      reasonCode: 'Other',
      reasonId: 10,
      notes: 'x',
      competitor: null,
      photoUris: ['file://a.jpg'],
      operationId: OP,
    });
    const parsed = parseNoSaleIntent(intent);
    assert.ok(parsed);
    assert.equal(parsed!.reason_code, 'other');
    assert.equal(parsed!.operation_id, OP);
  });

  it('round-trips review_required evidence without minting a replacement UUID', () => {
    const open = createOpenNoSaleIntent({
      stopId: 7,
      planId: null,
      operationalDate: null,
      reasonCode: 'closed',
      reasonId: 1,
      notes: '',
      competitor: null,
      photoUris: ['file://evidence.jpg'],
      operationId: OP,
    });
    const review = withNoSaleIntentState(open, 'review_required');
    const parsed = parseNoSaleIntent(review);
    assert.ok(parsed);
    assert.equal(parsed!.state, 'review_required');
    assert.equal(parsed!.operation_id, OP);
    assert.deepEqual(parsed!.photo_uris, ['file://evidence.jpg']);
  });

  it('rejects any attempt to reopen review_required evidence', () => {
    const review = withNoSaleIntentState(
      createOpenNoSaleIntent({
        stopId: 7,
        planId: null,
        operationalDate: null,
        reasonCode: 'closed',
        reasonId: 1,
        notes: '',
        competitor: null,
        photoUris: [],
        operationId: OP,
      }),
      'review_required',
    );
    assert.throws(() => assertNoSaleIntentCanOpen(review), /revisión/i);
  });
});
