import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import * as policy from '../src/services/fieldDataPersistenceLogic.ts';
import * as readiness from '../src/services/routeStartLogic.ts';

function evaluate(file, dependencies) {
  const exports = {};
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    console: { ...console, error() {} },
  }, { filename: file });
  return exports;
}

function setup({ fail = false, barrier = Promise.resolve() } = {}) {
  const records = new Map();
  const storage = evaluate('src/persistence/storage.ts', {
    '@react-native-async-storage/async-storage': { default: { removeItem: async () => {} } },
    '../services/fieldDataPersistenceLogic.ts': policy,
    '../services/fieldDataSession.ts': { getFieldDataSession: async () => ({ sessionId: 'test-session' }) },
    '../services/encryptedStore.ts': {
      saveEncrypted: async (_session, key, value) => {
        await barrier;
        if (fail) throw new Error('encrypted write failed');
        records.set(key, structuredClone(value));
      },
      loadEncrypted: async (_session, key) => records.get(key) ?? null,
    },
  });
  const makeStore = () => evaluate('src/stores/useRouteStartStore.ts', {
    zustand: { create: createStore },
    '../persistence/storage': storage,
    '../services/routeStartLogic': readiness,
    '../utils/logger': { logInfo() {} },
    '../services/routeStartAuthority': {},
  }).useRouteStartStore;
  const store = makeStore();
  store.setState({ planId: 123 });
  return { store, makeStore, records };
}

test('failed encrypted write rejects route start without publishing its marker', async () => {
  const { store, records } = setup({ fail: true });
  await assert.rejects(store.getState().markRouteStartedForPlan(123), /encrypted write failed/);
  assert.equal(store.getState().routeStartedPlanId, null);
  assert.equal(records.size, 0);
});

test('route start publishes only after saving and survives a new store instance', async () => {
  let release;
  const { store, makeStore, records } = setup({ barrier: new Promise(resolve => { release = resolve; }) });
  const pending = store.getState().markRouteStartedForPlan(123);
  assert.equal(store.getState().routeStartedPlanId, null);
  release();
  assert.equal(await pending, true);
  assert.equal(records.get('route:start').routeStartedPlanId, 123);
  assert.equal(store.getState().routeStartedPlanId, 123);
  const restarted = makeStore();
  await restarted.getState().hydrate();
  assert.equal(restarted.getState().planId, 123);
  assert.equal(restarted.getState().routeStartedPlanId, 123);
});

test('a marker for another plan does not write or unlock the current plan', async () => {
  const { store, records } = setup();
  assert.equal(await store.getState().markRouteStartedForPlan(456), false);
  assert.equal(store.getState().routeStartedPlanId, null);
  assert.equal(records.size, 0);
});
