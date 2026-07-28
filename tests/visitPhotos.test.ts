import assert from 'node:assert/strict';
import type { SyncEnqueueOptions } from '../src/types/sync';

interface VisitPhotosModule {
  appendVisitPhotoUri: (current: string[], uri: string) => string[];
  enqueueVisitPhotos: (input: {
    stopId: number;
    photoUris: string[];
    enqueue: (
      type: 'photo',
      payload: Record<string, unknown>,
      opts?: SyncEnqueueOptions,
    ) => string;
    dependsOn?: string[];
    holdProcessing?: boolean;
    imageType?: string;
  }) => string[];
}

function testAppendKeepsEveryCapturedPhoto(module: VisitPhotosModule) {
  const existing = ['file://photo-1.jpg', 'file://photo-2.jpg'];

  const next = module.appendVisitPhotoUri(existing, 'file://photo-3.jpg');

  assert.deepEqual(next, [
    'file://photo-1.jpg',
    'file://photo-2.jpg',
    'file://photo-3.jpg',
  ]);
  assert.notEqual(next, existing, 'append must not mutate the existing state array');
}

function testEnqueueCreatesOneUploadPerPhoto(module: VisitPhotosModule) {
  const calls: Array<{
    type: 'photo';
    payload: Record<string, unknown>;
    opts?: SyncEnqueueOptions;
  }> = [];

  const ids = module.enqueueVisitPhotos({
    stopId: 44,
    photoUris: [
      'file://photo-1.jpg',
      'file://photo-2.jpg',
    ],
    dependsOn: ['sale-op-1'],
    holdProcessing: true,
    enqueue: (type, payload, opts) => {
      calls.push({ type, payload, opts });
      return `photo-${calls.length}`;
    },
  });

  assert.deepEqual(ids, ['photo-1', 'photo-2']);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.payload.localUri),
    [
      'file://photo-1.jpg',
      'file://photo-2.jpg',
    ],
  );
  for (const call of calls) {
    assert.equal(call.type, 'photo');
    assert.equal(call.payload.stop_id, 44);
    assert.equal(call.payload.image_type, 'visit');
    assert.deepEqual(call.opts, {
      dependsOn: ['sale-op-1'],
      holdProcessing: true,
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(call.payload, 'image_base64'),
      false,
      'photo uploads should keep only the local URI until sync reads the file',
    );
  }
}

function testEnqueueAllowsSaleEvidenceImageType(module: VisitPhotosModule) {
  const calls: Array<{
    type: 'photo';
    payload: Record<string, unknown>;
    opts?: SyncEnqueueOptions;
  }> = [];

  const ids = module.enqueueVisitPhotos({
    stopId: 44,
    photoUris: ['file://sale-photo-1.jpg', 'file://sale-photo-2.jpg'],
    imageType: 'sale',
    enqueue: (type, payload, opts) => {
      calls.push({ type, payload, opts });
      return `sale-photo-${calls.length}`;
    },
  });

  assert.deepEqual(ids, ['sale-photo-1', 'sale-photo-2']);
  assert.deepEqual(calls.map((call) => call.payload.image_type), ['sale', 'sale']);
  assert.deepEqual(calls.map((call) => call.payload.localUri), [
    'file://sale-photo-1.jpg',
    'file://sale-photo-2.jpg',
  ]);
  assert.deepEqual(calls.map((call) => call.opts), [undefined, undefined]);
}

function testEnqueueCreatesIndependentExchangeEvidenceItems(module: VisitPhotosModule) {
  const calls: Array<{
    type: 'photo';
    payload: Record<string, unknown>;
    opts?: SyncEnqueueOptions;
  }> = [];

  const ids = module.enqueueVisitPhotos({
    stopId: 44,
    photoUris: ['file://exchange-photo-1.jpg', 'file://exchange-photo-2.jpg'],
    imageType: 'exchange',
    enqueue: (type, payload, opts) => {
      calls.push({ type, payload, opts });
      return `exchange-photo-${calls.length}`;
    },
  });

  assert.deepEqual(ids, ['exchange-photo-1', 'exchange-photo-2']);
  assert.notEqual(ids[0], ids[1], 'each exchange photo must get its own queue id');
  assert.equal(calls.length, 2);
  assert.notEqual(
    calls[0].payload,
    calls[1].payload,
    'each exchange photo must be represented by an independent queue payload',
  );
  assert.deepEqual(calls.map((call) => call.type), ['photo', 'photo']);
  assert.deepEqual(calls.map((call) => call.payload.stop_id), [44, 44]);
  assert.deepEqual(calls.map((call) => call.payload.localUri), [
    'file://exchange-photo-1.jpg',
    'file://exchange-photo-2.jpg',
  ]);
  assert.deepEqual(calls.map((call) => call.payload.image_type), ['exchange', 'exchange']);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.payload), ['stop_id', 'localUri', 'image_type']);
    assert.equal(
      Object.prototype.hasOwnProperty.call(call.payload, 'image_base64'),
      false,
      'exchange photo queue payloads must not include image_base64',
    );
  }
}

function testEnqueueKeepsDependsOnOnlyOptionsExact(module: VisitPhotosModule) {
  const options: Array<SyncEnqueueOptions | undefined> = [];

  module.enqueueVisitPhotos({
    stopId: 44,
    photoUris: ['file://legacy-photo.jpg'],
    dependsOn: ['sale-op-legacy'],
    enqueue: (_type, _payload, opts) => {
      options.push(opts);
      return 'legacy-photo-1';
    },
  });

  assert.deepEqual(options, [{ dependsOn: ['sale-op-legacy'] }]);
}

function testEnqueueIsolatesPhotoOptionsFromMutatingConsumers(module: VisitPhotosModule) {
  const dependsOn = ['sale-op-1'];
  const observed: SyncEnqueueOptions[] = [];

  module.enqueueVisitPhotos({
    stopId: 44,
    photoUris: ['file://photo-1.jpg', 'file://photo-2.jpg'],
    dependsOn,
    holdProcessing: true,
    enqueue: (_type, _payload, opts) => {
      assert.ok(opts);
      observed.push({
        ...opts,
        ...(opts.dependsOn ? { dependsOn: [...opts.dependsOn] } : {}),
      });
      opts.dependsOn?.push('consumer-mutation');
      opts.holdProcessing = false;
      return `photo-${observed.length}`;
    },
  });

  assert.deepEqual(observed, [
    {
      dependsOn: ['sale-op-1'],
      holdProcessing: true,
    },
    {
      dependsOn: ['sale-op-1'],
      holdProcessing: true,
    },
  ]);
  assert.deepEqual(dependsOn, ['sale-op-1']);
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/visitPhotos.ts', import.meta.url).pathname
  ) as VisitPhotosModule;

  testAppendKeepsEveryCapturedPhoto(module);
  testEnqueueCreatesOneUploadPerPhoto(module);
  testEnqueueAllowsSaleEvidenceImageType(module);
  testEnqueueCreatesIndependentExchangeEvidenceItems(module);
  testEnqueueKeepsDependsOnOnlyOptionsExact(module);
  testEnqueueIsolatesPhotoOptionsFromMutatingConsumers(module);
  console.log('visit photos tests: ok');
}

void main();
