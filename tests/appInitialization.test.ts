import assert from 'node:assert/strict';
import test from 'node:test';

interface InitializationModule {
  runNonblockingAppInitialization?: (deps: {
    startConnectivityMonitor: () => void;
    checkConnectivity: () => Promise<boolean>;
    initializeAppState: () => Promise<void>;
    onConfirmedOnline: () => void;
    onConnectivityError: (error: unknown) => void;
    onInitializationError: (error: unknown) => void;
    onReady: () => void;
  }) => Promise<void>;
}

async function loadInitialization(): Promise<InitializationModule> {
  try {
    return await import('../src/services/appInitialization.ts') as InitializationModule;
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}

test('an unresolved connectivity probe never blocks rehydration or app readiness and cannot send', async () => {
  const mod = await loadInitialization();
  assert.equal(typeof mod.runNonblockingAppInitialization, 'function', 'startup orchestration must be independently testable');

  let monitorStarts = 0;
  let rehydrations = 0;
  let ready = false;
  let transports = 0;
  const neverResolvingProbe = new Promise<boolean>(() => {});

  const startup = mod.runNonblockingAppInitialization!({
    startConnectivityMonitor: () => { monitorStarts += 1; },
    checkConnectivity: () => neverResolvingProbe,
    initializeAppState: async () => { rehydrations += 1; },
    onConfirmedOnline: () => { transports += 1; },
    onConnectivityError: () => {},
    onInitializationError: (error) => assert.fail(String(error)),
    onReady: () => { ready = true; },
  });

  const result = await Promise.race([
    startup.then(() => 'ready' as const),
    new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 25)),
  ]);
  assert.equal(result, 'ready');
  assert.equal(monitorStarts, 1);
  assert.equal(rehydrations, 1);
  assert.equal(ready, true);
  assert.equal(transports, 0);
});

test('a confirmed probe wakes collection only after authenticated initialization completes', async () => {
  const mod = await loadInitialization();
  assert.equal(typeof mod.runNonblockingAppInitialization, 'function');

  let releaseInitialization!: () => void;
  const initialization = new Promise<void>((resolve) => { releaseInitialization = resolve; });
  let wakes = 0;
  const startup = mod.runNonblockingAppInitialization!({
    startConnectivityMonitor: () => {},
    checkConnectivity: async () => true,
    initializeAppState: () => initialization,
    onConfirmedOnline: () => { wakes += 1; },
    onConnectivityError: (error) => assert.fail(String(error)),
    onInitializationError: (error) => assert.fail(String(error)),
    onReady: () => {},
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(wakes, 0, 'confirmed connectivity cannot replay before auth/rehydration');
  releaseInitialization();
  await startup;
  assert.equal(wakes, 1);
});
