import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createContextSingleFlight,
  describeInventoryAuthority,
  isProductLoadInvocationCurrent,
} from '../src/services/productInventoryFreshness.ts';

test('marks fresh online scoped loads for the expected warehouse as authoritative', () => {
  assert.equal(describeInventoryAuthority({
    isOnline: true,
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'truck_stock',
    fromCache: false,
  }), 'authoritative');
  assert.equal(describeInventoryAuthority({
    isOnline: true,
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'stock_quant',
    fromCache: false,
  }), 'authoritative');
});

test('keeps cached and unknown inventory non-authoritative when connectivity returns', () => {
  const base = {
    isOnline: true,
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'truck_stock' as const,
  };

  assert.equal(describeInventoryAuthority({ ...base, fromCache: true }), 'cached');
  assert.equal(describeInventoryAuthority({
    ...base,
    fromCache: false,
    inventorySource: null,
  }), 'unknown');
  assert.equal(describeInventoryAuthority({
    ...base,
    fromCache: false,
    inventorySource: 'global_legacy',
  }), 'unknown');
});

test('requires confirmed connectivity and the same positive safe warehouse', () => {
  const base = {
    isOnline: true,
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'truck_stock' as const,
    fromCache: false,
  };

  assert.equal(describeInventoryAuthority({ ...base, isOnline: false }), 'unknown');
  assert.equal(describeInventoryAuthority({ ...base, loadedWarehouseId: 9 }), 'unknown');
  assert.equal(describeInventoryAuthority({ ...base, loadedWarehouseId: null }), 'unknown');
  assert.equal(describeInventoryAuthority({ ...base, expectedWarehouseId: 0 }), 'unknown');
  assert.equal(describeInventoryAuthority({
    ...base,
    loadedWarehouseId: Number.MAX_SAFE_INTEGER + 1,
    expectedWarehouseId: Number.MAX_SAFE_INTEGER + 1,
  }), 'unknown');
});

test('is runtime-safe for malformed JavaScript callers', () => {
  assert.equal(describeInventoryAuthority(null as never), 'unknown');
  assert.equal(describeInventoryAuthority({
    isOnline: 'yes',
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'truck_stock',
    fromCache: false,
  } as never), 'unknown');
  assert.equal(describeInventoryAuthority({
    isOnline: true,
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'server_guess',
    fromCache: false,
  } as never), 'unknown');
});

type RefreshResult =
  | { ok: true; source: string }
  | { ok: false; reason: 'failed' | 'superseded' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('coalesces same-context authoritative refreshes into the same pending promise', async () => {
  const gate = deferred<RefreshResult>();
  let loads = 0;
  let legacyRefreshPending = true;
  const coordinator = createContextSingleFlight<RefreshResult>(() => ({
    ok: false,
    reason: 'superseded',
  }));
  const refresh = () => coordinator.run('employee:1|warehouse:8', async () => {
    loads += 1;
    return gate.promise;
  });

  const first = refresh();
  const second = refresh();
  assert.equal(first, second);
  assert.equal(loads, 0, 'the task starts after the promise is published');
  await Promise.resolve();
  assert.equal(loads, 1);

  let settled = false;
  void second.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, 'prior authoritative state must not produce an early success');

  gate.resolve({ ok: false, reason: 'failed' });
  const result = await first;
  if (result.ok) legacyRefreshPending = false;
  assert.deepEqual(result, { ok: false, reason: 'failed' });
  assert.equal(legacyRefreshPending, true, 'a failed active load must preserve refresh pending');
});

test('a context change supersedes the old refresh without letting its cleanup clear the new one', async () => {
  const firstGate = deferred<RefreshResult>();
  const secondGate = deferred<RefreshResult>();
  const coordinator = createContextSingleFlight<RefreshResult>(() => ({
    ok: false,
    reason: 'superseded',
  }));

  const first = coordinator.run('employee:1|warehouse:8', () => firstGate.promise);
  const second = coordinator.run('employee:1|warehouse:9', () => secondGate.promise);
  assert.notEqual(first, second);

  firstGate.resolve({ ok: true, source: 'truck_stock' });
  assert.deepEqual(await first, { ok: false, reason: 'superseded' });

  const coalescedSecond = coordinator.run(
    'employee:1|warehouse:9',
    () => Promise.resolve({ ok: false, reason: 'failed' }),
  );
  assert.equal(coalescedSecond, second, 'stale cleanup must not delete the active context entry');
  secondGate.resolve({ ok: true, source: 'stock_quant' });
  assert.deepEqual(await second, { ok: true, source: 'stock_quant' });
});

test('reset supersedes pending work and active sync throws or rejections clean up for retry', async () => {
  const gate = deferred<RefreshResult>();
  const coordinator = createContextSingleFlight<RefreshResult>(() => ({
    ok: false,
    reason: 'superseded',
  }));
  const pending = coordinator.run('ctx', () => gate.promise);
  coordinator.invalidate();
  gate.reject(new Error('old network failure'));
  assert.deepEqual(await pending, { ok: false, reason: 'superseded' });

  await assert.rejects(
    coordinator.run('ctx', () => { throw new Error('sync failure'); }),
    /sync failure/,
  );
  await assert.rejects(
    coordinator.run('ctx', async () => { throw new Error('async failure'); }),
    /async failure/,
  );
  assert.deepEqual(
    await coordinator.run('ctx', async () => ({ ok: true, source: 'truck_stock' })),
    { ok: true, source: 'truck_stock' },
  );
});

test('an exact product-load invocation is superseded by a direct same-context load', () => {
  const priorSharedState = {
    inventoryFreshness: 'authoritative',
    inventorySource: 'truck_stock',
    loadedWarehouseId: 8,
  };
  let legacyRefreshPending = true;
  const authoritativeInvocation = {
    generation: 41,
    contextIdentity: 'employee:1|warehouse:8',
  };

  // A public load starts while the authoritative call is pending. Its failure
  // may leave the prior authoritative state in memory, but generation 42 still
  // makes invocation A ineligible for publication.
  const directLoadGeneration = 42;
  const current = isProductLoadInvocationCurrent({
    invocation: authoritativeInvocation,
    currentGeneration: directLoadGeneration,
    currentContextIdentity: 'employee:1|warehouse:8',
  });
  if (current && priorSharedState.inventoryFreshness === 'authoritative') {
    legacyRefreshPending = false;
  }

  assert.equal(current, false);
  assert.equal(legacyRefreshPending, true);
});

test('hydrate or reset supersedes an exact product-load invocation', () => {
  const invocation = {
    generation: 8,
    contextIdentity: 'employee:1|warehouse:8',
  };
  assert.equal(isProductLoadInvocationCurrent({
    invocation,
    currentGeneration: 9,
    currentContextIdentity: 'employee:1|warehouse:8',
  }), false, 'hydrate increments the catalog generation');
  assert.equal(isProductLoadInvocationCurrent({
    invocation,
    currentGeneration: 9,
    currentContextIdentity: null,
  }), false, 'reset invalidates both generation and context');
  assert.equal(isProductLoadInvocationCurrent({
    invocation,
    currentGeneration: 8,
    currentContextIdentity: 'employee:1|warehouse:8',
  }), true);
});

test('product-load invocation checks fail closed for malformed runtime input', () => {
  assert.equal(isProductLoadInvocationCurrent(null as never), false);
  assert.equal(isProductLoadInvocationCurrent({
    invocation: { generation: Number.MAX_SAFE_INTEGER + 1, contextIdentity: 'ctx' },
    currentGeneration: Number.MAX_SAFE_INTEGER + 1,
    currentContextIdentity: 'ctx',
  }), false);
  assert.equal(isProductLoadInvocationCurrent({
    invocation: { generation: 1, contextIdentity: '' },
    currentGeneration: 1,
    currentContextIdentity: '',
  }), false);
});
