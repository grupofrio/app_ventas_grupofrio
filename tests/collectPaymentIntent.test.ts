/**
 * Tests for FE-1 collect payment single-flight + stable operation_id.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCollectPaymentController } from '../src/services/collectPaymentIntent.ts';

describe('collectPaymentIntent', () => {
  it('A: double tap immediate → one enqueue / one operation_id', () => {
    const calls: Array<{ payload: Record<string, unknown>; opts: { operationId: string } }> = [];
    let n = 0;
    const ctrl = createCollectPaymentController({
      uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      enqueue: (_t, payload, opts) => {
        calls.push({ payload, opts });
        return opts.operationId;
      },
    });
    const a = ctrl.submit({ partnerId: 10, amount: 100, journalId: 1, paymentMethod: 'cash' });
    const b = ctrl.submit({ partnerId: 10, amount: 100, journalId: 1, paymentMethod: 'cash' });
    assert.equal(a.status, 'enqueued');
    assert.equal(b.status, 'ignored_done');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.operationId, '00000000-0000-4000-8000-000000000001');
    assert.equal(calls[0].payload.operation_id, calls[0].opts.operationId);
  });

  it('B: tap while submitting → ignored', () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const calls: string[] = [];
    const ctrl = createCollectPaymentController({
      uuid: () => '00000000-0000-4000-8000-0000000000aa',
      enqueue: (_t, _p, opts) => {
        calls.push(opts.operationId);
        // Simulate slow path by not returning until release — but enqueue is sync
        // in production; we emulate by checking phase mid-submit via nested call.
        void gate;
        return opts.operationId;
      },
    });
    // Force submitting phase: custom enqueue that re-enters submit
    const reentrant = createCollectPaymentController({
      uuid: () => '00000000-0000-4000-8000-0000000000bb',
      enqueue: (_t, _p, opts) => {
        const nested = reentrant.submit({
          partnerId: 10,
          amount: 50,
          journalId: 1,
          paymentMethod: 'cash',
        });
        assert.equal(nested.status, 'ignored_inflight');
        return opts.operationId;
      },
    });
    const out = reentrant.submit({
      partnerId: 10,
      amount: 50,
      journalId: 1,
      paymentMethod: 'cash',
    });
    assert.equal(out.status, 'enqueued');
  });

  it('C: timeout/retry → same operation_id', () => {
    let shouldFail = true;
    const ids: string[] = [];
    const ctrl = createCollectPaymentController({
      uuid: () => '00000000-0000-4000-8000-0000000000cc',
      enqueue: (_t, _p, opts) => {
        ids.push(opts.operationId);
        if (shouldFail) {
          shouldFail = false;
          throw new Error('network timeout');
        }
        return opts.operationId;
      },
    });
    assert.throws(() =>
      ctrl.submit({ partnerId: 7, amount: 20, journalId: 1, paymentMethod: 'cash' }),
    );
    const retry = ctrl.submit({ partnerId: 7, amount: 20, journalId: 1, paymentMethod: 'cash' });
    assert.equal(retry.status, 'enqueued');
    assert.deepEqual(ids, [
      '00000000-0000-4000-8000-0000000000cc',
      '00000000-0000-4000-8000-0000000000cc',
    ]);
  });

  it('E: backend/enqueue reject → UI returns to idle with same id retained', () => {
    const ctrl = createCollectPaymentController({
      uuid: () => '00000000-0000-4000-8000-0000000000ee',
      enqueue: () => {
        throw new Error('reject');
      },
    });
    assert.throws(() =>
      ctrl.submit({ partnerId: 1, amount: 5, journalId: 1, paymentMethod: 'cash' }),
    );
    assert.equal(ctrl.getPhase(), 'idle');
    assert.equal(ctrl.getOperationId(), '00000000-0000-4000-8000-0000000000ee');
  });

  it('G: partner A operation cannot be reused for partner B without new id', () => {
    let n = 0;
    const ctrl = createCollectPaymentController({
      uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      enqueue: (_t, _p, opts) => opts.operationId,
    });
    const a = ctrl.submit({ partnerId: 1, amount: 10, journalId: 1, paymentMethod: 'cash' });
    assert.equal(a.status, 'enqueued');
    ctrl.reset();
    const b = ctrl.submit({ partnerId: 2, amount: 10, journalId: 1, paymentMethod: 'cash' });
    assert.equal(b.status, 'enqueued');
    if (a.status === 'enqueued' && b.status === 'enqueued') {
      assert.notEqual(a.operationId, b.operationId);
    }
  });

  it('amount change after failure mints new intent', () => {
    let n = 0;
    const ctrl = createCollectPaymentController({
      uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      enqueue: (_t, _p, opts) => {
        if (n === 1) throw new Error('fail');
        return opts.operationId;
      },
    });
    assert.throws(() =>
      ctrl.submit({ partnerId: 1, amount: 10, journalId: 1, paymentMethod: 'cash' }),
    );
    ctrl.onIntentInputsChanged(1, 99);
    const next = ctrl.submit({ partnerId: 1, amount: 99, journalId: 1, paymentMethod: 'cash' });
    assert.equal(next.status, 'enqueued');
    if (next.status === 'enqueued') {
      assert.equal(next.operationId, '00000000-0000-4000-8000-000000000002');
    }
  });
});
