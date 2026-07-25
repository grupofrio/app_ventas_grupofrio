import assert from 'node:assert/strict';
import test from 'node:test';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { storeLoadStrict } from '../src/persistence/storage.ts';
import type { SaleTicketSnapshot } from '../src/services/saleTicket.ts';
import { SALE_TICKET_DEFAULT_SELLER } from '../src/services/saleTicket.ts';
import * as saleTicketStorage from '../src/services/saleTicketStorage.ts';
import type { SaleTicketStorageAdapter } from '../src/services/saleTicketStorage.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function withRawStoredValue<T>(
  raw: string | null,
  operation: () => Promise<T>,
): Promise<T> {
  const storage = AsyncStorage as unknown as {
    getItem?: (key: string) => Promise<string | null>;
  };
  const originalGetItem = storage.getItem;
  storage.getItem = async () => raw;
  try {
    return await operation();
  } finally {
    if (originalGetItem) {
      storage.getItem = originalGetItem;
    } else {
      delete storage.getItem;
    }
  }
}

function snapshot(
  overrides: Partial<SaleTicketSnapshot> = {},
): SaleTicketSnapshot {
  return {
    saleId: 'sale-storage-1',
    odooFolio: null,
    customerName: 'Abarrotes Centro',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    paymentLabel: 'Efectivo',
    createdAt: '2026-07-24T18:00:00.000Z',
    lines: [],
    subtotal: 100,
    total: 100,
    totalKg: 10,
    ...overrides,
  };
}

test('strict load distinguishes an absent key from a present JSON null payload', async () => {
  assert.equal(
    await withRawStoredValue(null, () => storeLoadStrict('sale-ticket:absent')),
    null,
  );

  await assert.rejects(
    withRawStoredValue('null', () => storeLoadStrict('sale-ticket:corrupt-null')),
    /persisted null/i,
  );
});

test('normalizes a legacy stored ticket without an Odoo folio and applies the seller fallback', () => {
  const { odooFolio: _omitted, ...legacySnapshot } = snapshot({
    sellerName: '   ',
  });

  assert.deepEqual(
    saleTicketStorage.normalizeStoredSaleTicketSnapshot(legacySnapshot),
    {
      ...legacySnapshot,
      odooFolio: null,
      sellerName: SALE_TICKET_DEFAULT_SELLER,
    },
  );
});

test('normalizes a parsed ticket with a non-string seller to the fallback without throwing', () => {
  const corruptedSnapshot = {
    ...snapshot(),
    sellerName: 42,
  } as unknown as Parameters<
    typeof saleTicketStorage.normalizeStoredSaleTicketSnapshot
  >[0];
  let normalized: SaleTicketSnapshot | undefined;

  assert.doesNotThrow(() => {
    normalized = saleTicketStorage.normalizeStoredSaleTicketSnapshot(corruptedSnapshot);
  });
  assert.equal(normalized?.sellerName, SALE_TICKET_DEFAULT_SELLER);
});

test('merging never erases an official folio and permits a later official folio update', () => {
  const current = snapshot({ odooFolio: 'S00041', total: 100 });
  const pendingUpdate = snapshot({ odooFolio: null, total: 125 });

  const preserved = saleTicketStorage.mergeStoredSaleTicketSnapshot(
    current,
    pendingUpdate,
  );
  assert.equal(preserved.odooFolio, 'S00041');
  assert.equal(preserved.total, 125);

  const promoted = saleTicketStorage.mergeStoredSaleTicketSnapshot(
    preserved,
    snapshot({ odooFolio: '  S00042  ', total: 125 }),
  );
  assert.equal(promoted.odooFolio, 'S00042');
});

test('promotes an existing stored ticket to an official Odoo folio', async () => {
  const values = new Map<string, unknown>([
    ['sale-ticket:sale-promote', snapshot({ saleId: 'sale-promote' })],
  ]);
  const savedKeys: string[] = [];
  const adapter: SaleTicketStorageAdapter = {
    async load<T>(key: string): Promise<T | null> {
      return (values.get(key) ?? null) as T | null;
    },
    async save<T>(key: string, value: T): Promise<void> {
      savedKeys.push(key);
      values.set(key, value);
    },
  };

  const result = await saleTicketStorage.promoteStoredSaleTicketOdooFolio(
    'sale-promote',
    '  S00042  ',
    adapter,
  );

  assert.equal(result, 'updated');
  assert.deepEqual(savedKeys, ['sale-ticket:sale-promote']);
  assert.equal(
    (values.get('sale-ticket:sale-promote') as SaleTicketSnapshot).odooFolio,
    'S00042',
  );
});

test('promotion reports missing only after a successful strict read finds no ticket', async () => {
  let saveCalled = false;
  const adapter: SaleTicketStorageAdapter = {
    async load<T>(): Promise<T | null> {
      return null;
    },
    async save<T>(): Promise<void> {
      saveCalled = true;
    },
  };

  assert.equal(
    await saleTicketStorage.promoteStoredSaleTicketOdooFolio(
      'sale-confirmed-missing',
      'S00042',
      adapter,
    ),
    'missing',
  );
  assert.equal(saveCalled, false);
});

test('promotion rejects a present JSON null ticket instead of reporting it missing', async () => {
  await assert.rejects(
    withRawStoredValue('null', () => (
      saleTicketStorage.promoteStoredSaleTicketOdooFolio(
        'sale-corrupt-null',
        'S00042',
      )
    )),
    /persisted null/i,
  );
});

test('promotion rejects strict read and write failures', async () => {
  const readFailure: SaleTicketStorageAdapter = {
    async load<T>(): Promise<T | null> {
      throw new Error('read failed');
    },
    async save<T>(): Promise<void> {},
  };
  await assert.rejects(
    saleTicketStorage.promoteStoredSaleTicketOdooFolio(
      'sale-read-failure',
      'S00042',
      readFailure,
    ),
    /read failed/,
  );

  const writeFailure: SaleTicketStorageAdapter = {
    async load<T>(): Promise<T | null> {
      return snapshot({ saleId: 'sale-write-failure' }) as T;
    },
    async save<T>(): Promise<void> {
      throw new Error('write failed');
    },
  };
  await assert.rejects(
    saleTicketStorage.promoteStoredSaleTicketOdooFolio(
      'sale-write-failure',
      'S00042',
      writeFailure,
    ),
    /write failed/,
  );
});

test('concurrent official and pending saves serialize so pending cannot erase the folio', async () => {
  const saleId = 'sale-race';
  const key = `sale-ticket:${saleId}`;
  const values = new Map<string, unknown>();
  const firstSaveStarted = deferred<void>();
  const releaseFirstSave = deferred<void>();
  const secondSaveStarted = deferred<void>();
  const releaseSecondSave = deferred<void>();
  let loadCount = 0;
  let saveCount = 0;
  const adapter: SaleTicketStorageAdapter = {
    async load<T>(storageKey: string): Promise<T | null> {
      loadCount += 1;
      return (values.get(storageKey) ?? null) as T | null;
    },
    async save<T>(storageKey: string, value: T): Promise<void> {
      saveCount += 1;
      if (saveCount === 1) {
        firstSaveStarted.resolve();
        await releaseFirstSave.promise;
      } else {
        secondSaveStarted.resolve();
        await releaseSecondSave.promise;
      }
      values.set(storageKey, value);
    },
  };

  const officialSave = saleTicketStorage.saveSaleTicketSnapshot(
    snapshot({ saleId, odooFolio: 'S00042' }),
    adapter,
  );
  const pendingSave = saleTicketStorage.saveSaleTicketSnapshot(
    snapshot({ saleId, odooFolio: null }),
    adapter,
  );

  await firstSaveStarted.promise;
  assert.equal(loadCount, 1, 'the pending read must wait behind the official write');
  releaseFirstSave.resolve();
  await secondSaveStarted.promise;
  releaseSecondSave.resolve();
  await Promise.all([officialSave, pendingSave]);

  assert.equal((values.get(key) as SaleTicketSnapshot).odooFolio, 'S00042');
});

test('a rejected write does not poison the keyed tail for a later write', async () => {
  const saleId = 'sale-retry-after-failure';
  const key = `sale-ticket:${saleId}`;
  const values = new Map<string, unknown>();
  const firstSaveStarted = deferred<void>();
  const rejectFirstSave = deferred<void>();
  let saveCount = 0;
  const adapter: SaleTicketStorageAdapter = {
    async load<T>(storageKey: string): Promise<T | null> {
      return (values.get(storageKey) ?? null) as T | null;
    },
    async save<T>(storageKey: string, value: T): Promise<void> {
      saveCount += 1;
      if (saveCount === 1) {
        firstSaveStarted.resolve();
        await rejectFirstSave.promise;
      }
      values.set(storageKey, value);
    },
  };

  const failedSave = saleTicketStorage.saveSaleTicketSnapshot(
    snapshot({ saleId, odooFolio: 'S00041' }),
    adapter,
  );
  const failedAssertion = assert.rejects(failedSave, /disk full/);
  await firstSaveStarted.promise;
  const laterSave = saleTicketStorage.saveSaleTicketSnapshot(
    snapshot({ saleId, odooFolio: 'S00042' }),
    adapter,
  );

  rejectFirstSave.reject(new Error('disk full'));
  await failedAssertion;
  await laterSave;

  assert.equal((values.get(key) as SaleTicketSnapshot).odooFolio, 'S00042');
  assert.equal(saveCount, 2);
});
