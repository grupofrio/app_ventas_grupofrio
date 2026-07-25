import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSalesLoadCoordinator,
  shouldRefreshSalesAfterQueueChange,
} from '../src/services/salesRefreshPolicy.ts';

interface TestSummary {
  total: number;
}

interface TestOrder {
  id: number;
}

interface TestSalesState {
  summary: TestSummary;
  orders: TestOrder[];
  count: number;
  isLoading: boolean;
  error: string | null;
  lastLoadedAt: number | null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('refreshes when a sale finishes syncing', () => {
  const previous = [{
    id: 'sale-1',
    type: 'sale_order',
    status: 'syncing',
  }];
  const current = [{
    id: 'sale-1',
    type: 'sale_order',
    status: 'done',
  }];

  assert.equal(
    shouldRefreshSalesAfterQueueChange(previous, current),
    true,
  );
});

test('refreshes when an already-completed sale is observed for the first time', () => {
  assert.equal(
    shouldRefreshSalesAfterQueueChange(
      [{ id: 'visit-1', type: 'checkout', status: 'syncing' }],
      [{ id: ' sale-2 ', type: 'sale_order', status: 'done' }],
    ),
    true,
  );
});

test('refreshes when a sale completion is observed without an intermediate syncing snapshot', () => {
  assert.equal(
    shouldRefreshSalesAfterQueueChange(
      [{ id: 'sale-3', type: 'sale_order', status: 'pending' }],
      [{ id: 'sale-3', type: 'sale_order', status: 'done' }],
    ),
    true,
  );
});

test('does not refresh for non-authoritative sale transitions', () => {
  const cases: Array<[unknown, unknown]> = [
    [
      [{ id: 'sale-1', type: 'sale_order', status: 'pending' }],
      [{ id: 'sale-1', type: 'sale_order', status: 'error' }],
    ],
    [
      [{ id: 'visit-1', type: 'checkout', status: 'syncing' }],
      [{ id: 'visit-1', type: 'checkout', status: 'done' }],
    ],
    [
      [{ id: 'sale-1', type: 'sale_order', status: 'syncing' }],
      [],
    ],
    [
      [{ id: 'sale-1', type: 'sale_order', status: 'done' }],
      [{ id: 'sale-1', type: 'sale_order', status: 'done' }],
    ],
  ];

  for (const [previous, current] of cases) {
    assert.equal(
      shouldRefreshSalesAfterQueueChange(previous, current),
      false,
    );
  }
});

test('ignores malformed runtime queue values safely', () => {
  const malformedCases: Array<[unknown, unknown]> = [
    [null, undefined],
    [
      [{ id: 12, type: 'sale_order', status: 'syncing' }],
      [{ id: 12, type: 'sale_order', status: 'done' }],
    ],
    [
      [{ id: '   ', type: 'sale_order', status: 'syncing' }],
      [{ id: '   ', type: 'sale_order', status: 'done' }],
    ],
    [
      [{ id: 'sale-1', type: 'sale_order', status: 'mystery' }],
      [{ id: 'sale-1', type: 'sale_order', status: 'done' }],
    ],
    [
      [{ id: 'sale-1', type: 'sale_order', status: 'syncing' }],
      [{ id: 'sale-1', type: 'sale_order', status: 'mystery' }],
    ],
  ];

  for (const [previous, current] of malformedCases) {
    assert.doesNotThrow(() => {
      const decision = shouldRefreshSalesAfterQueueChange(previous, current);
      assert.equal(typeof decision, 'boolean');
    });
  }
});

test('returns safely for hostile runtime queue values', () => {
  const throwingItem = new Proxy({}, {
    get() {
      throw new Error('hostile queue item');
    },
  });
  const revokedItem = Proxy.revocable({}, {});
  revokedItem.revoke();
  const revokedQueue = Proxy.revocable([], {});
  revokedQueue.revoke();

  assert.doesNotThrow(() => {
    assert.equal(
      shouldRefreshSalesAfterQueueChange(
        [throwingItem, revokedItem.proxy],
        [{ id: 'sale-1', type: 'sale_order', status: 'done' }],
      ),
      true,
    );
  });
  assert.doesNotThrow(() => {
    assert.equal(
      shouldRefreshSalesAfterQueueChange(
        [],
        revokedQueue.proxy,
      ),
      false,
    );
  });
});

test('coalesces every call made during an active sales request', async () => {
  const firstSummary = deferred<TestSummary>();
  const firstList = deferred<{ count: number; orders: TestOrder[] }>();
  let summaryCalls = 0;
  let listCalls = 0;
  let state: TestSalesState = {
    summary: { total: 10 },
    orders: [{ id: 1 }],
    count: 1,
    isLoading: false,
    error: 'anterior',
    lastLoadedAt: 100,
  };

  const load = createSalesLoadCoordinator({
    fetchSummary: () => {
      summaryCalls += 1;
      return firstSummary.promise;
    },
    fetchList: () => {
      listCalls += 1;
      return firstList.promise;
    },
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
    },
    now: () => 200,
  });

  const first = load();
  const forcedWhileActive = load({ force: true });
  const ordinaryWhileActive = load();

  assert.strictEqual(forcedWhileActive, first);
  assert.strictEqual(ordinaryWhileActive, first);
  assert.equal(state.isLoading, true);
  assert.equal(state.error, null);

  for (let turn = 0; turn < 20 && summaryCalls === 0; turn += 1) {
    await Promise.resolve();
  }
  assert.equal(summaryCalls, 1);
  assert.equal(listCalls, 1);

  firstSummary.resolve({ total: 42 });
  firstList.resolve({ count: 2, orders: [{ id: 2 }, { id: 3 }] });
  await first;

  assert.deepEqual(state, {
    summary: { total: 42 },
    orders: [{ id: 2 }, { id: 3 }],
    count: 2,
    isLoading: false,
    error: null,
    lastLoadedAt: 200,
  });
  assert.equal(summaryCalls, 1, 'force no debe programar una segunda carga');
  assert.equal(listCalls, 1, 'force no debe programar una segunda carga');
});

test('publishes the active promise before loading state can reenter', async () => {
  const summary = deferred<TestSummary>();
  const list = deferred<{ count: number; orders: TestOrder[] }>();
  let summaryCalls = 0;
  let listCalls = 0;
  let didReenter = false;
  let reentrantPromise: Promise<void> | undefined;
  let state: TestSalesState = {
    summary: { total: 1 },
    orders: [],
    count: 0,
    isLoading: false,
    error: null,
    lastLoadedAt: null,
  };
  let load!: ReturnType<typeof createSalesLoadCoordinator<TestSummary, TestOrder>>;

  load = createSalesLoadCoordinator({
    fetchSummary: () => {
      summaryCalls += 1;
      return summary.promise;
    },
    fetchList: () => {
      listCalls += 1;
      return list.promise;
    },
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
      if (patch.isLoading === true && !didReenter) {
        didReenter = true;
        reentrantPromise = load({ force: true });
      }
    },
  });

  const first = load();

  assert.strictEqual(reentrantPromise, first);
  for (let turn = 0; turn < 20 && summaryCalls === 0; turn += 1) {
    await Promise.resolve();
  }
  assert.equal(summaryCalls, 1);
  assert.equal(listCalls, 1);

  summary.resolve({ total: 2 });
  list.resolve({ count: 1, orders: [{ id: 2 }] });
  await first;
});

test('preserves prior sales data when loading fails', async () => {
  const priorSummary = { total: 25 };
  const priorOrders = [{ id: 7 }];
  let state: TestSalesState = {
    summary: priorSummary,
    orders: priorOrders,
    count: 1,
    isLoading: false,
    error: null,
    lastLoadedAt: 123,
  };

  const load = createSalesLoadCoordinator({
    fetchSummary: async () => {
      throw new Error('network');
    },
    fetchList: async () => ({ count: 0, orders: [] as TestOrder[] }),
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
    },
    now: () => 999,
  });

  await load();

  assert.strictEqual(state.summary, priorSummary);
  assert.strictEqual(state.orders, priorOrders);
  assert.equal(state.count, 1);
  assert.equal(state.lastLoadedAt, 123);
  assert.equal(state.isLoading, false);
  assert.equal(state.error, 'network');
});

test('keeps the load coalesced until both requests settle after one fails', async () => {
  const summary = deferred<TestSummary>();
  const list = deferred<{ count: number; orders: TestOrder[] }>();
  let summaryCalls = 0;
  let listCalls = 0;
  let state: TestSalesState = {
    summary: { total: 25 },
    orders: [{ id: 7 }],
    count: 1,
    isLoading: false,
    error: null,
    lastLoadedAt: 123,
  };

  const load = createSalesLoadCoordinator({
    fetchSummary: () => {
      summaryCalls += 1;
      return summary.promise;
    },
    fetchList: () => {
      listCalls += 1;
      return list.promise;
    },
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
    },
  });

  const first = load();
  let firstSettled = false;
  void first.then(() => {
    firstSettled = true;
  });
  await Promise.resolve();
  summary.reject(new Error('summary failed'));
  for (let turn = 0; turn < 20 && !firstSettled; turn += 1) {
    await Promise.resolve();
  }

  assert.equal(firstSettled, false);
  const whileListIsPending = load({ force: true });
  assert.strictEqual(whileListIsPending, first);
  assert.equal(summaryCalls, 1);
  assert.equal(listCalls, 1);

  list.resolve({ count: 0, orders: [] });
  await first;
  assert.equal(state.error, 'summary failed');
});

test('invalidates an old generation before a reset and isolates the next load', async () => {
  const summaries = [
    deferred<TestSummary>(),
    deferred<TestSummary>(),
  ];
  const lists = [
    deferred<{ count: number; orders: TestOrder[] }>(),
    deferred<{ count: number; orders: TestOrder[] }>(),
  ];
  let summaryCalls = 0;
  let listCalls = 0;
  let state: TestSalesState = {
    summary: { total: 10 },
    orders: [{ id: 1 }],
    count: 1,
    isLoading: false,
    error: null,
    lastLoadedAt: 100,
  };

  const load = createSalesLoadCoordinator({
    fetchSummary: () => summaries[summaryCalls++].promise,
    fetchList: () => lists[listCalls++].promise,
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
    },
    now: () => 300,
  });

  const oldRequest = load();
  for (let turn = 0; turn < 20 && summaryCalls < 1; turn += 1) {
    await Promise.resolve();
  }

  load.invalidate();
  state = {
    summary: { total: 0 },
    orders: [],
    count: 0,
    isLoading: false,
    error: null,
    lastLoadedAt: null,
  };

  const newRequest = load({ force: true });
  assert.notStrictEqual(newRequest, oldRequest);
  for (let turn = 0; turn < 20 && summaryCalls < 2; turn += 1) {
    await Promise.resolve();
  }
  assert.equal(summaryCalls, 2);
  assert.equal(listCalls, 2);

  const stateWhileNewRequestIsActive = state;
  summaries[0].resolve({ total: 999 });
  lists[0].resolve({ count: 1, orders: [{ id: 999 }] });
  await oldRequest;
  assert.strictEqual(state, stateWhileNewRequestIsActive);
  assert.strictEqual(load(), newRequest);

  summaries[1].resolve({ total: 20 });
  lists[1].resolve({ count: 1, orders: [{ id: 2 }] });
  await newRequest;
  assert.deepEqual(state, {
    summary: { total: 20 },
    orders: [{ id: 2 }],
    count: 1,
    isLoading: false,
    error: null,
    lastLoadedAt: 300,
  });
});

test('a stale failure cannot publish an error or clear the new active request', async () => {
  const summaries = [
    deferred<TestSummary>(),
    deferred<TestSummary>(),
  ];
  const lists = [
    deferred<{ count: number; orders: TestOrder[] }>(),
    deferred<{ count: number; orders: TestOrder[] }>(),
  ];
  let summaryCalls = 0;
  let listCalls = 0;
  let state: TestSalesState = {
    summary: { total: 0 },
    orders: [],
    count: 0,
    isLoading: false,
    error: null,
    lastLoadedAt: null,
  };

  const load = createSalesLoadCoordinator({
    fetchSummary: () => summaries[summaryCalls++].promise,
    fetchList: () => lists[listCalls++].promise,
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
    },
    now: () => 400,
  });

  const oldRequest = load();
  for (let turn = 0; turn < 20 && summaryCalls < 1; turn += 1) {
    await Promise.resolve();
  }
  load.invalidate();
  state = {
    summary: { total: 0 },
    orders: [],
    count: 0,
    isLoading: false,
    error: null,
    lastLoadedAt: null,
  };

  const newRequest = load();
  for (let turn = 0; turn < 20 && summaryCalls < 2; turn += 1) {
    await Promise.resolve();
  }
  const stateWhileNewRequestIsActive = state;

  summaries[0].reject(new Error('stale failure'));
  lists[0].resolve({ count: 0, orders: [] });
  await oldRequest;
  assert.strictEqual(state, stateWhileNewRequestIsActive);
  assert.strictEqual(load({ force: true }), newRequest);

  summaries[1].resolve({ total: 40 });
  lists[1].resolve({ count: 1, orders: [{ id: 4 }] });
  await newRequest;
  assert.equal(state.error, null);
  assert.equal(state.summary.total, 40);
});

test('force only bypasses an idle cache skip', async () => {
  let calls = 0;
  let state: TestSalesState = {
    summary: { total: 1 },
    orders: [],
    count: 0,
    isLoading: false,
    error: null,
    lastLoadedAt: 100,
  };

  const load = createSalesLoadCoordinator({
    fetchSummary: async () => {
      calls += 1;
      return { total: 2 };
    },
    fetchList: async () => ({ count: 0, orders: [] as TestOrder[] }),
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
    },
    now: () => 200,
    shouldSkip: () => true,
  });

  await load();
  assert.equal(calls, 0);
  assert.equal(state.summary.total, 1);

  await load({ force: true });
  assert.equal(calls, 1);
  assert.equal(state.summary.total, 2);
});
