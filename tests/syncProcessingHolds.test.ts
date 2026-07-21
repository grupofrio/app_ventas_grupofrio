import assert from 'node:assert/strict';

interface ProcessingHolds {
  hold: (ids: string[]) => void;
  release: (ids: string[]) => void;
  isHeld: (id: string) => boolean;
  withoutHeld: <T extends { id: string }>(items: T[]) => T[];
}

interface ProcessingHoldsModule {
  createSyncProcessingHolds: () => ProcessingHolds;
}

function testHoldsFiltersAndReleasesIndependently(m: ProcessingHoldsModule) {
  const holds = m.createSyncProcessingHolds();
  const sale = { id: 'sale-1', value: 'sale' };
  const photo = { id: 'photo-1', value: 'photo' };
  const other = { id: 'other', value: 'other' };

  holds.hold([' sale-1 ', 'photo-1']);
  assert.equal(holds.isHeld('sale-1'), true);
  assert.equal(holds.isHeld(' photo-1 '), true, 'lookups normalize ids too');
  assert.deepEqual(holds.withoutHeld([sale, photo, other]), [other]);

  holds.release(['sale-1']);
  assert.equal(holds.isHeld('sale-1'), false);
  assert.equal(holds.isHeld('photo-1'), true, 'releasing sale leaves photo held');
  assert.deepEqual(holds.withoutHeld([sale, photo, other]), [sale, other]);
}

function testHoldAndReleaseAreIdempotentAndIgnoreEmptyIds(m: ProcessingHoldsModule) {
  const holds = m.createSyncProcessingHolds();
  const item = { id: 'sale-1' };

  holds.hold(['', '   ', ' sale-1 ', 'sale-1']);
  holds.hold(['sale-1']);
  assert.equal(holds.isHeld('sale-1'), true);
  assert.equal(holds.isHeld(''), false);
  assert.equal(holds.isHeld('   '), false);
  assert.deepEqual(holds.withoutHeld([item, { id: '' }, { id: 'other' }]), [
    { id: '' },
    { id: 'other' },
  ]);

  holds.release(['', '   ', 'missing', 'sale-1', 'sale-1']);
  holds.release(['sale-1']);
  assert.equal(holds.isHeld('sale-1'), false);
  assert.equal(holds.withoutHeld([item])[0], item);
}

async function main() {
  const module = await import(
    // @ts-ignore -- import.meta is only used by the Node test runtime.
    new URL('../src/services/syncProcessingHolds.ts', import.meta.url).pathname
  ) as ProcessingHoldsModule;

  testHoldsFiltersAndReleasesIndependently(module);
  testHoldAndReleaseAreIdempotentAndIgnoreEmptyIds(module);

  console.log('sync processing holds tests: ok');
}

void main();
