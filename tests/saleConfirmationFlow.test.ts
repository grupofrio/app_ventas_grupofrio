import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSaleConfirmationSingleFlight,
  safeUnknownErrorMessage,
  shouldResumeAfterSale,
} from '../src/services/saleConfirmationFlow.ts';

const resumableSale = {
  saleConfirmed: true,
  hasAfterSaleAction: false,
  stopExists: true,
  saleSubmitting: false,
  saleRecoveryPersistenceFailed: false,
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
  });
  const afterSubmitting = shouldResumeAfterSale({
    ...resumableSale,
    saleSubmitting: false,
    saleRecoveryPersistenceFailed: true,
  });

  assert.equal(whileSubmitting, false);
  assert.equal(afterSubmitting, false);
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
