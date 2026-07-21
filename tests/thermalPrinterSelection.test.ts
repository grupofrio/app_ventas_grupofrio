import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createThermalPrinterSelectionStore,
  parseSavedThermalPrinter,
} from '../src/services/thermalPrinterSelection.ts';

test('parseSavedThermalPrinter accepts a valid versioned selection and nullable name', () => {
  const named = { version: 1, name: 'MP210', address: 'AA:bb:09:10:EF:f0' };
  const unnamed = { version: 1, name: null, address: '00:11:22:33:44:55' };
  const nullPrototype = Object.assign(Object.create(null), named);

  assert.deepEqual(parseSavedThermalPrinter(named), named);
  assert.deepEqual(parseSavedThermalPrinter(unnamed), unnamed);
  assert.deepEqual(parseSavedThermalPrinter(nullPrototype), named);
});

test('parseSavedThermalPrinter rejects class instances and custom prototypes', () => {
  class PersistedSelection {
    version = 1;
    name = 'MP210';
    address = '00:11:22:33:44:55';
  }
  const customPrototype = Object.assign(Object.create({ inherited: true }), {
    version: 1,
    name: 'MP210',
    address: '00:11:22:33:44:55',
  });

  assert.equal(parseSavedThermalPrinter(new PersistedSelection()), null);
  assert.equal(parseSavedThermalPrinter(customPrototype), null);
});

test('parseSavedThermalPrinter returns null for hostile introspection and property access', () => {
  const valid = { version: 1, name: 'MP210', address: '00:11:22:33:44:55' };
  let getterReads = 0;
  const throwingGetter = Object.defineProperties(Object.create(null), {
    version: { enumerable: true, value: 1 },
    name: {
      enumerable: true,
      get() {
        getterReads += 1;
        throw new Error('hostile name getter');
      },
    },
    address: { enumerable: true, value: '00:11:22:33:44:55' },
  });
  const hostileValues: unknown[] = [
    new Proxy(valid, {
      getPrototypeOf() {
        throw new Error('hostile prototype trap');
      },
    }),
    new Proxy(valid, {
      ownKeys() {
        throw new Error('hostile keys trap');
      },
    }),
    throwingGetter,
  ];

  for (const value of hostileValues) {
    assert.doesNotThrow(() => {
      assert.equal(parseSavedThermalPrinter(value), null);
    });
  }
  assert.equal(getterReads, 0, 'validation must inspect descriptors without invoking getters');
});

test('parseSavedThermalPrinter rejects malformed persisted selections', () => {
  const malformed: unknown[] = [
    null,
    [],
    { version: 2, name: 'MP210', address: '00:11:22:33:44:55' },
    { version: 1, address: '00:11:22:33:44:55' },
    { version: 1, name: 210, address: '00:11:22:33:44:55' },
    { version: 1, name: 'MP210', address: '00-11-22-33-44-55' },
    { version: 1, name: 'MP210', address: '0:11:22:33:44:55' },
    { version: 1, name: 'MP210', address: 'GG:11:22:33:44:55' },
    { version: 1, name: 'MP210', address: '00:11:22:33:44:55:66' },
    { version: 1, name: 'MP210', address: '00:11:22:33:44:55', extra: true },
  ];

  for (const value of malformed) {
    assert.equal(parseSavedThermalPrinter(value), null);
  }
});

test('selection store validates loaded data and uses the centralized storage key', async () => {
  let raw: unknown = { version: 1, name: 'Impresora de ruta', address: 'A0:B1:C2:D3:E4:F5' };
  const loadedKeys: string[] = [];
  const store = createThermalPrinterSelectionStore({
    load: async (key) => {
      loadedKeys.push(key);
      return raw;
    },
    save: async () => {},
    remove: async () => {},
  });

  assert.deepEqual(await store.load(), raw);
  assert.deepEqual(loadedKeys, ['preferences:thermalPrinter']);

  raw = { version: 1, name: 'MP210', address: 'not-a-mac' };
  assert.equal(await store.load(), null);
});

test('selection store saves and removes through its strict persistence boundary', async () => {
  const calls: Array<{ operation: string; key: string; value?: unknown }> = [];
  const store = createThermalPrinterSelectionStore({
    load: async () => null,
    save: async (key, value) => {
      calls.push({ operation: 'save', key, value });
    },
    remove: async (key) => {
      calls.push({ operation: 'remove', key });
    },
  });

  await store.save({ name: null, address: '10:20:30:40:50:60' });
  await store.remove();

  assert.deepEqual(calls, [
    {
      operation: 'save',
      key: 'preferences:thermalPrinter',
      value: { version: 1, name: null, address: '10:20:30:40:50:60' },
    },
    { operation: 'remove', key: 'preferences:thermalPrinter' },
  ]);
});

test('selection store rejects an invalid address instead of persisting it', async () => {
  let saveCalled = false;
  const store = createThermalPrinterSelectionStore({
    load: async () => null,
    save: async () => {
      saveCalled = true;
    },
    remove: async () => {},
  });

  await assert.rejects(
    store.save({ name: 'MP210', address: '10-20-30-40-50-60' }),
    /Bluetooth address/i,
  );
  assert.equal(saveCalled, false);
});

test('selection store rejects an invalid runtime name before persisting it', async () => {
  let saveCalled = false;
  const store = createThermalPrinterSelectionStore({
    load: async () => null,
    save: async () => {
      saveCalled = true;
    },
    remove: async () => {},
  });
  const invalidSelection = {
    name: 210,
    address: '00:11:22:33:44:55',
  } as unknown as Parameters<typeof store.save>[0];

  await assert.rejects(
    store.save(invalidSelection),
    /thermal printer selection/i,
  );
  assert.equal(saveCalled, false);
});
