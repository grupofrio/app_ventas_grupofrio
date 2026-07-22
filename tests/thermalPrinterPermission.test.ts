import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createThermalPrinterService,
  type ThermalPrinterAccessResult,
} from '../src/services/thermalPrinter.ts';
import type {
  BluetoothState,
  BondedBluetoothDevice,
  ThermalPrinterNativeModule,
} from '../modules/thermal-printer/index.ts';

type PermissionResult = 'granted' | 'denied' | 'never_ask_again';

function nativeModule(overrides: {
  getBluetoothState?: () => Promise<BluetoothState>;
  getBondedDevices?: () => Promise<BondedBluetoothDevice[]>;
} = {}): ThermalPrinterNativeModule {
  return {
    getBluetoothState: overrides.getBluetoothState ?? (async () => 'on'),
    getBondedDevices: overrides.getBondedDevices ?? (async () => []),
    printTicket: async () => ({
      transportBytesWritten: 0,
      rasterBytesWritten: 0,
      bandsCompleted: 0,
      rasterPayloadAttempted: false,
    }),
    printDiagnostic: async () => ({
      transportBytesWritten: 0,
      rasterBytesWritten: 0,
      bandsCompleted: 0,
      rasterPayloadAttempted: false,
    }),
  };
}

function factory(input: {
  platform?: 'android' | 'ios' | 'web';
  androidApiLevel?: number;
  native?: ThermalPrinterNativeModule | null;
  permission?: () => Promise<PermissionResult>;
} = {}) {
  return createThermalPrinterService({
    platform: input.platform ?? 'android',
    androidApiLevel: input.androidApiLevel ?? 31,
    native: input.native === undefined ? nativeModule() : input.native,
    requestConnectPermission: input.permission ?? (async () => 'granted'),
  });
}

test('non-Android reports an unsupported platform without touching permission or native APIs', async () => {
  let permissionCalls = 0;
  let nativeCalls = 0;
  const native = nativeModule({
    getBluetoothState: async () => {
      nativeCalls += 1;
      return 'on';
    },
    getBondedDevices: async () => {
      nativeCalls += 1;
      return [];
    },
  });

  const result = await factory({
    platform: 'ios',
    native,
    permission: async () => {
      permissionCalls += 1;
      return 'granted';
    },
  }).prepare();

  assert.deepEqual(result, {
    status: 'unsupported_platform',
    platform: 'ios',
    savedPrinter: null,
  });
  assert.equal(permissionCalls, 0);
  assert.equal(nativeCalls, 0);
});

test('Android without the optional native module reports that a new native build is unavailable', async () => {
  let permissionCalls = 0;

  const result = await factory({
    native: null,
    permission: async () => {
      permissionCalls += 1;
      return 'granted';
    },
  }).prepare();

  assert.deepEqual(result, {
    status: 'native_unavailable',
    savedPrinter: null,
  });
  assert.equal(permissionCalls, 0);
});

test('Android API 30 reads state then paired devices without a runtime permission prompt', async () => {
  const events: string[] = [];
  const native = nativeModule({
    getBluetoothState: async () => {
      events.push('state');
      return 'on';
    },
    getBondedDevices: async () => {
      events.push('devices');
      return [{ name: 'MP210', address: 'aa:bb:cc:dd:ee:ff' }];
    },
  });

  const result = await factory({
    androidApiLevel: 30,
    native,
    permission: async () => {
      events.push('permission');
      return 'denied';
    },
  }).prepare();

  assert.deepEqual(events, ['state', 'devices']);
  assert.deepEqual(result, {
    status: 'ready',
    devices: [{ name: 'MP210', address: 'AA:BB:CC:DD:EE:FF' }],
    savedPrinter: null,
    savedPrinterBonded: null,
  });
});

test('Android API 31 requests CONNECT before protected reads and distinguishes both denials', async (t) => {
  for (const permission of ['denied', 'never_ask_again'] as const) {
    await t.test(permission, async () => {
      const events: string[] = [];
      const native = nativeModule({
        getBluetoothState: async () => {
          events.push('state');
          return 'on';
        },
        getBondedDevices: async () => {
          events.push('devices');
          return [];
        },
      });
      const result = await factory({
        native,
        permission: async () => {
          events.push('permission');
          return permission;
        },
      }).prepare();

      assert.deepEqual(events, ['permission']);
      assert.deepEqual(result, {
        status: permission === 'denied' ? 'permission_denied' : 'permission_permanently_denied',
        savedPrinter: null,
      });
    });
  }

  const grantedEvents: string[] = [];
  const granted = await factory({
    native: nativeModule({
      getBluetoothState: async () => {
        grantedEvents.push('state');
        return 'on';
      },
      getBondedDevices: async () => {
        grantedEvents.push('devices');
        return [];
      },
    }),
    permission: async () => {
      grantedEvents.push('permission');
      return 'granted';
    },
  }).prepare();

  assert.deepEqual(grantedEvents, ['permission', 'state', 'devices']);
  assert.equal(granted.status, 'ready');
});

test('Bluetooth unsupported and off are explicit and do not list devices', async (t) => {
  for (const state of ['unsupported', 'off'] as const) {
    await t.test(state, async () => {
      let deviceCalls = 0;
      const result = await factory({
        native: nativeModule({
          getBluetoothState: async () => state,
          getBondedDevices: async () => {
            deviceCalls += 1;
            return [];
          },
        }),
      }).prepare();

      assert.deepEqual(result, {
        status: state === 'unsupported' ? 'bluetooth_unsupported' : 'bluetooth_off',
        savedPrinter: null,
      });
      assert.equal(deviceCalls, 0);
    });
  }
});

test('paired devices are validated, copied, frozen, and sorted with exact MP210 names first', async () => {
  const mutableName = { name: 'zeta', address: '00:00:00:00:00:09' };
  const mutableDevices: unknown[] = [
    { name: null, address: '00:00:00:00:00:08' },
    mutableName,
    { name: 'alpha', address: '00:00:00:00:00:04' },
    { name: 'ALPHA', address: '00:00:00:00:00:03' },
    { name: 'mp210', address: '00:00:00:00:00:02' },
    { name: ' MP210 ', address: '00:00:00:00:00:05' },
    { name: 'MP210', address: '00:00:00:00:00:01' },
    { name: null, address: '00:00:00:00:00:00' },
    { name: 210, address: '00:00:00:00:00:06' },
    { name: 'Bad address', address: 'not-a-mac' },
  ];
  const result = await factory({
    native: nativeModule({
      getBondedDevices: async () => mutableDevices as BondedBluetoothDevice[],
    }),
  }).prepare();

  mutableName.name = 'changed';
  mutableName.address = 'FF:FF:FF:FF:FF:FF';
  mutableDevices.length = 0;

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.deepEqual(result.devices, [
    { name: ' MP210 ', address: '00:00:00:00:00:05' },
    { name: 'MP210', address: '00:00:00:00:00:01' },
    { name: 'mp210', address: '00:00:00:00:00:02' },
    { name: 'ALPHA', address: '00:00:00:00:00:03' },
    { name: 'alpha', address: '00:00:00:00:00:04' },
    { name: 'zeta', address: '00:00:00:00:00:09' },
    { name: null, address: '00:00:00:00:00:00' },
    { name: null, address: '00:00:00:00:00:08' },
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.devices), true);
  assert.equal(result.devices.every(Object.isFrozen), true);
  assert.throws(() => {
    (result.devices as BondedBluetoothDevice[]).push({
      name: 'Injected',
      address: '11:22:33:44:55:66',
    });
  }, TypeError);
});

test('saved printer bond status compares addresses case-insensitively and preserves a snapshot', async (t) => {
  const saved = {
    version: 1 as const,
    name: 'Mi MP210',
    address: 'aa:bb:cc:dd:ee:ff',
  };

  const bonded = await factory({
    native: nativeModule({
      getBondedDevices: async () => [
        { name: 'MP210', address: 'AA:BB:CC:DD:EE:FF' },
      ],
    }),
  }).prepare(saved);
  saved.name = 'changed after call';

  assert.equal(bonded.status, 'ready');
  if (bonded.status === 'ready') {
    assert.deepEqual(bonded.savedPrinter, {
      version: 1,
      name: 'Mi MP210',
      address: 'aa:bb:cc:dd:ee:ff',
    });
    assert.equal(bonded.savedPrinterBonded, true);
    assert.equal(Object.isFrozen(bonded.savedPrinter), true);
  }

  await t.test('no longer paired', async () => {
    const missing = await factory().prepare({
      version: 1,
      name: 'Old MP210',
      address: '10:20:30:40:50:60',
    });
    assert.equal(missing.status, 'ready');
    if (missing.status === 'ready') {
      assert.deepEqual(missing.savedPrinter, {
        version: 1,
        name: 'Old MP210',
        address: '10:20:30:40:50:60',
      });
      assert.equal(missing.savedPrinterBonded, false);
    }
  });
});

test('concurrent prepares share one Android CONNECT permission request', async () => {
  let permissionCalls = 0;
  let releasePermission!: (value: PermissionResult) => void;
  const permission = new Promise<PermissionResult>((resolve) => {
    releasePermission = resolve;
  });
  const service = factory({
    permission: () => {
      permissionCalls += 1;
      return permission;
    },
  });

  const first = service.prepare();
  const second = service.prepare();
  assert.equal(permissionCalls, 1);
  releasePermission('granted');

  const outcomes = await Promise.all([first, second]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ['ready', 'ready']);
  assert.equal(permissionCalls, 1);
});

test('native rejections become safe typed outcomes and preserve a stable exposed code', async (t) => {
  const privateError = new Error('adapter internals and user details');
  Object.assign(privateError, { code: 'permission_denied' });
  const coded = await factory({
    native: nativeModule({ getBluetoothState: async () => Promise.reject(privateError) }),
  }).prepare();

  assert.deepEqual(coded, {
    status: 'native_error',
    code: 'permission_denied',
    savedPrinter: null,
  });
  assert.equal(JSON.stringify(coded).includes(privateError.message), false);

  await t.test('hostile rejection', async () => {
    const revocable = Proxy.revocable({ code: 'write_failed' }, {});
    revocable.revoke();
    const outcome = await factory({
      native: nativeModule({ getBluetoothState: async () => Promise.reject(revocable.proxy) }),
    }).prepare();
    assert.deepEqual(outcome, {
      status: 'native_error',
      code: null,
      savedPrinter: null,
    });
  });
});

test('public access outcomes remain exactly discriminated at compile time', () => {
  const describe = (outcome: ThermalPrinterAccessResult): string => {
    switch (outcome.status) {
      case 'unsupported_platform':
        return outcome.platform;
      case 'native_unavailable':
      case 'permission_denied':
      case 'permission_permanently_denied':
      case 'permission_request_failed':
      case 'bluetooth_unsupported':
      case 'bluetooth_off':
        return outcome.status;
      case 'native_error':
        return outcome.code ?? 'unknown';
      case 'ready':
        return String(outcome.devices.length);
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  };

  assert.equal(typeof describe, 'function');
});
