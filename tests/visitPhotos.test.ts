import assert from 'node:assert/strict';

interface VisitPhotosModule {
  appendVisitPhotoUri: (current: string[], uri: string) => string[];
  enqueueVisitPhotos: (input: {
    stopId: number;
    photoUris: string[];
    enqueue: (
      type: 'photo',
      payload: Record<string, unknown>,
      opts?: { dependsOn?: string[] },
    ) => string;
    dependsOn?: string[];
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
    opts?: { dependsOn?: string[] };
  }> = [];

  const ids = module.enqueueVisitPhotos({
    stopId: 44,
    photoUris: [
      'file://photo-1.jpg',
      'file://photo-2.jpg',
      'file://photo-3.jpg',
      'file://photo-4.jpg',
    ],
    dependsOn: ['sale-1'],
    enqueue: (type, payload, opts) => {
      calls.push({ type, payload, opts });
      return `photo-${calls.length}`;
    },
  });

  assert.deepEqual(ids, ['photo-1', 'photo-2', 'photo-3', 'photo-4']);
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map((call) => call.payload.localUri),
    [
      'file://photo-1.jpg',
      'file://photo-2.jpg',
      'file://photo-3.jpg',
      'file://photo-4.jpg',
    ],
  );
  for (const call of calls) {
    assert.equal(call.type, 'photo');
    assert.equal(call.payload.stop_id, 44);
    assert.equal(call.payload.image_type, 'visit');
    assert.deepEqual(call.opts, { dependsOn: ['sale-1'] });
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
    opts?: { dependsOn?: string[] };
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
  console.log('visit photos tests: ok');
}

void main();
