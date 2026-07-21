import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSaleConfirmationSingleFlight,
  hasQueuedSaleOrderRecoveryEvidence,
  safeUnknownErrorMessage,
  shouldResumeAfterSale,
} from '../src/services/saleConfirmationFlow.ts';

const resumableSale = {
  saleConfirmed: true,
  hasAfterSaleAction: false,
  stopExists: true,
  saleSubmitting: false,
  saleRecoveryPersistenceFailed: false,
  saleReadyToContinue: true,
  hasQueuedSaleOrderEvidence: false,
};

test('resumes only a confirmed sale with a stop and no active or failed transition', () => {
  assert.equal(shouldResumeAfterSale(resumableSale), true);

  for (const blocked of [
    { saleConfirmed: false },
    { hasAfterSaleAction: true },
    { stopExists: false },
    { saleSubmitting: true },
    { saleRecoveryPersistenceFailed: true },
  ]) {
    assert.equal(
      shouldResumeAfterSale({ ...resumableSale, ...blocked }),
      false,
      `resume must stay blocked for ${JSON.stringify(blocked)}`,
    );
  }
});

test('a durable recovery persistence failure stays blocked after submission ends', () => {
  const whileSubmitting = shouldResumeAfterSale({
    ...resumableSale,
    saleSubmitting: true,
    saleRecoveryPersistenceFailed: true,
    hasQueuedSaleOrderEvidence: true,
  });
  const afterSubmitting = shouldResumeAfterSale({
    ...resumableSale,
    saleSubmitting: false,
    saleRecoveryPersistenceFailed: true,
    hasQueuedSaleOrderEvidence: true,
  });

  assert.equal(whileSubmitting, false);
  assert.equal(afterSubmitting, false);
});

test('resumes from either matching queued evidence or a durable terminal marker', () => {
  const matchingSale = [
    { id: 'sale-op-restored', type: 'sale_order' },
  ];
  const differentSale = [
    { id: 'sale-op-other', type: 'sale_order' },
  ];
  const matchingPhotoOnly = [
    { id: 'sale-op-restored', type: 'photo' },
  ];

  assert.equal(
    shouldResumeAfterSale({
      ...resumableSale,
      saleReadyToContinue: false,
      hasQueuedSaleOrderEvidence: hasQueuedSaleOrderRecoveryEvidence(
        'sale-op-restored',
        [],
      ),
    }),
    false,
  );
  assert.equal(
    shouldResumeAfterSale({
      ...resumableSale,
      saleReadyToContinue: false,
      hasQueuedSaleOrderEvidence: hasQueuedSaleOrderRecoveryEvidence(
        'sale-op-restored',
        matchingSale,
      ),
    }),
    true,
  );
  assert.equal(
    shouldResumeAfterSale({
      ...resumableSale,
      saleReadyToContinue: true,
      hasQueuedSaleOrderEvidence: false,
    }),
    true,
    'a completed queue item may be filtered once the terminal marker is durable',
  );
  assert.equal(
    shouldResumeAfterSale({
      ...resumableSale,
      saleReadyToContinue: true,
      hasQueuedSaleOrderEvidence: false,
    }),
    true,
    'direct online success resumes from its durable marker',
  );
  assert.equal(
    shouldResumeAfterSale({
      ...resumableSale,
      saleReadyToContinue: false,
      hasQueuedSaleOrderEvidence: hasQueuedSaleOrderRecoveryEvidence(null, []),
    }),
    false,
    'a null operation id is not evidence by itself',
  );
  assert.equal(
    shouldResumeAfterSale({
      ...resumableSale,
      saleReadyToContinue: false,
      hasQueuedSaleOrderEvidence: hasQueuedSaleOrderRecoveryEvidence(
        'sale-op-restored',
        [],
      ),
    }),
    false,
    'an operation id without queue evidence is not terminal',
  );
  assert.equal(
    hasQueuedSaleOrderRecoveryEvidence('sale-op-restored', differentSale),
    false,
  );
  assert.equal(
    hasQueuedSaleOrderRecoveryEvidence('sale-op-restored', matchingPhotoOnly),
    false,
  );
});

test('a current-session persistence failure wins over every recovery signal', () => {
  assert.equal(shouldResumeAfterSale({
    ...resumableSale,
    saleRecoveryPersistenceFailed: true,
    saleReadyToContinue: true,
    hasQueuedSaleOrderEvidence: true,
  }), false);
});

test('single-flight admits one immediate confirmation and can be released', () => {
  const singleFlight = createSaleConfirmationSingleFlight();
  let entries = 0;
  const attempt = () => {
    if (singleFlight.tryAcquire()) entries += 1;
  };

  attempt();
  attempt();
  assert.equal(entries, 1);
  assert.equal(singleFlight.isActive, true);

  singleFlight.release();
  assert.equal(singleFlight.isActive, false);
  attempt();
  assert.equal(entries, 2);
});

test('safe unknown error messages preserve only readable strings', () => {
  const nullPrototype = Object.assign(Object.create(null), {
    message: 'Fallo sin prototipo',
  });

  assert.equal(safeUnknownErrorMessage(new Error('Fallo Error'), 'respaldo'), 'Fallo Error');
  assert.equal(safeUnknownErrorMessage('Fallo string', 'respaldo'), 'Fallo string');
  assert.equal(safeUnknownErrorMessage(nullPrototype, 'respaldo'), 'Fallo sin prototipo');
  assert.equal(safeUnknownErrorMessage('', 'respaldo'), 'respaldo');
  assert.equal(safeUnknownErrorMessage(Symbol('hostil'), 'respaldo'), 'respaldo');
});

test('safe unknown error messages never throw for hostile objects', () => {
  const hostilePrototype = new Proxy(Object.create(null), {
    getPrototypeOf() {
      throw new Error('prototype denied');
    },
    get() {
      throw new Error('property denied');
    },
  });
  const hostileMessage = Object.defineProperty({}, 'message', {
    get() {
      throw new Error('message denied');
    },
  });

  for (const value of [hostilePrototype, hostileMessage]) {
    assert.doesNotThrow(() => safeUnknownErrorMessage(value, 'respaldo seguro'));
    assert.equal(safeUnknownErrorMessage(value, 'respaldo seguro'), 'respaldo seguro');
  }
});
