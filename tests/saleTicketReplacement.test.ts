import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  shouldReplaceTicketSnapshot,
  type SaleTicketOrigin,
  type SaleTicketSnapshot,
} from '../src/services/saleTicket.ts';
import {
  createSaleTicketSnapshotRepository,
  type SaleTicketSnapshotStorage,
} from '../src/services/saleTicketStorage.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ticket(
  saleId: string,
  origin?: SaleTicketOrigin,
  unitPrice = 50,
): SaleTicketSnapshot {
  return {
    saleId,
    ...(origin === undefined ? {} : { origin }),
    customerName: 'Abarrotes Lupita',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    paymentLabel: 'Efectivo',
    createdAt: '2026-07-21T10:00:00.000Z',
    lines: [{
      productId: 7,
      productName: 'Hielo',
      qty: 2,
      unitPrice,
      lineTotal: unitPrice * 2,
      weight: 5,
      priceSource: 'prepared_customer',
      priceCapturedAtMs: 1_753_350_000_000,
      pricelistId: 81,
    }],
    subtotal: unitPrice * 2,
    total: unitPrice * 2,
    totalKg: 10,
  };
}

function memoryStorage(
  initial: Record<string, SaleTicketSnapshot> = {},
): {
  durable: Map<string, SaleTicketSnapshot>;
  writes: Array<{ key: string; snapshot: SaleTicketSnapshot }>;
  storage: SaleTicketSnapshotStorage;
} {
  const durable = new Map(
    Object.entries(initial).map(([key, value]) => [key, clone(value)]),
  );
  const writes: Array<{ key: string; snapshot: SaleTicketSnapshot }> = [];
  return {
    durable,
    writes,
    storage: {
      load: async (key) => {
        const value = durable.get(key);
        return value === undefined ? null : clone(value);
      },
      saveStrict: async (key, snapshot) => {
        const copy = clone(snapshot);
        writes.push({ key, snapshot: copy });
        durable.set(key, copy);
      },
    },
  };
}

test('ticket replacement policy is deterministic and defaults legacy origin to local', () => {
  assert.equal(shouldReplaceTicketSnapshot({
    existingOrigin: 'local',
    incomingOrigin: 'odoo',
  }), true);
  assert.equal(shouldReplaceTicketSnapshot({
    existingOrigin: 'odoo',
    incomingOrigin: 'local',
  }), false);
  assert.equal(shouldReplaceTicketSnapshot({
    existingOrigin: 'odoo',
    incomingOrigin: 'odoo',
  }), true);
  assert.equal(shouldReplaceTicketSnapshot({
    existingOrigin: undefined,
    incomingOrigin: 'odoo',
  }), true);
  assert.equal(shouldReplaceTicketSnapshot({
    existingOrigin: undefined,
    incomingOrigin: 'local',
  }), true);
});

test('authoritative Odoo ticket replaces local and legacy snapshots for the same operation', async () => {
  for (const existing of [ticket('sale-op-1', 'local', 50), ticket('sale-op-1', undefined, 55)]) {
    const memory = memoryStorage({ 'sale-ticket:sale-op-1': existing });
    const repository = createSaleTicketSnapshotRepository(memory.storage);

    const saved = await repository.saveAuthoritative(ticket('sale-op-1', 'local', 60));

    assert.equal(saved, true);
    assert.equal(memory.writes.length, 1);
    assert.equal(memory.writes[0].key, 'sale-ticket:sale-op-1');
    assert.equal(memory.writes[0].snapshot.origin, 'odoo');
    assert.equal(memory.writes[0].snapshot.lines[0].unitPrice, 60);
    assert.equal(memory.writes[0].snapshot.lines[0].priceSource, 'prepared_customer');
  }
});

test('local save never overwrites Odoo, while Odoo refresh replaces Odoo', async () => {
  const memory = memoryStorage({
    'sale-ticket:sale-op-1': ticket('sale-op-1', 'odoo', 60),
  });
  const repository = createSaleTicketSnapshotRepository(memory.storage);

  const localSaved = await repository.saveLocal(ticket('sale-op-1', undefined, 50));
  const authoritativeSaved = await repository.saveAuthoritative(
    ticket('sale-op-1', 'local', 70),
  );

  assert.equal(localSaved, false);
  assert.equal(authoritativeSaved, true);
  assert.equal(memory.writes.length, 1);
  assert.equal(memory.durable.get('sale-ticket:sale-op-1')?.origin, 'odoo');
  assert.equal(memory.durable.get('sale-ticket:sale-op-1')?.total, 140);
});

test('local writes retain tolerant persistence while authoritative writes stay strict', async () => {
  let tolerantWrites = 0;
  let strictWrites = 0;
  const repository = createSaleTicketSnapshotRepository({
    load: async () => null,
    save: async () => {
      tolerantWrites += 1;
    },
    saveStrict: async () => {
      strictWrites += 1;
    },
  });

  assert.equal(await repository.saveLocal(ticket('sale-local', 'local')), true);
  assert.equal(
    await repository.saveAuthoritative(ticket('sale-odoo', 'odoo')),
    true,
  );
  assert.equal(tolerantWrites, 1);
  assert.equal(strictWrites, 1);
});

test('strict storage failure rejects and leaves the previous ticket untouched', async () => {
  const existing = ticket('sale-op-1', 'local', 50);
  const durable = new Map([['sale-ticket:sale-op-1', clone(existing)]]);
  const repository = createSaleTicketSnapshotRepository({
    load: async (key) => clone(durable.get(key) ?? null),
    saveStrict: async () => {
      throw new Error('disk full');
    },
  });

  await assert.rejects(
    repository.saveAuthoritative(ticket('sale-op-1', 'odoo', 60)),
    /disk full/,
  );
  assert.deepEqual(durable.get('sale-ticket:sale-op-1'), existing);
});

test('strict load failure performs no save, preserves state, and does not poison later writes', async () => {
  const existing = ticket('sale-op-1', 'odoo', 50);
  const durable = new Map([['sale-ticket:sale-op-1', clone(existing)]]);
  let shouldRejectLoad = true;
  let saveCalls = 0;
  const repository = createSaleTicketSnapshotRepository({
    load: async (key) => {
      if (shouldRejectLoad) {
        shouldRejectLoad = false;
        throw new Error('read unavailable');
      }
      return clone(durable.get(key) ?? null);
    },
    saveStrict: async (key, snapshot) => {
      saveCalls += 1;
      durable.set(key, clone(snapshot));
    },
  });

  await assert.rejects(
    repository.saveAuthoritative(ticket('sale-op-1', 'odoo', 60)),
    /read unavailable/,
  );
  assert.equal(saveCalls, 0);
  assert.deepEqual(durable.get('sale-ticket:sale-op-1'), existing);

  assert.equal(
    await repository.saveAuthoritative(ticket('sale-op-1', 'odoo', 70)),
    true,
  );
  assert.equal(saveCalls, 1);
  assert.equal(durable.get('sale-ticket:sale-op-1')?.total, 140);
});

test('local read failure fails closed without breaking tolerant local callers', async () => {
  const existing = ticket('sale-op-1', 'odoo', 50);
  const durable = new Map([['sale-ticket:sale-op-1', clone(existing)]]);
  let shouldRejectLoad = true;
  let saveCalls = 0;
  const repository = createSaleTicketSnapshotRepository({
    load: async (key) => {
      if (shouldRejectLoad) {
        shouldRejectLoad = false;
        throw new Error('read unavailable');
      }
      return clone(durable.get(key) ?? null);
    },
    save: async (key, snapshot) => {
      saveCalls += 1;
      durable.set(key, clone(snapshot));
    },
    saveStrict: async () => {
      throw new Error('local save must not use strict writer');
    },
  });

  assert.equal(await repository.saveLocal(ticket('sale-op-1', 'local', 60)), false);
  assert.equal(saveCalls, 0);
  assert.deepEqual(durable.get('sale-ticket:sale-op-1'), existing);

  assert.equal(await repository.saveLocal(ticket('sale-op-1', 'local', 70)), false);
  assert.equal(saveCalls, 0);
  assert.deepEqual(durable.get('sale-ticket:sale-op-1'), existing);
});

test('production policy writes use strict loads while read-only ticket loading remains tolerant', () => {
  const persistence = readFileSync(
    resolve(process.cwd(), 'src/persistence/storage.ts'),
    'utf8',
  );
  const ticketStorage = readFileSync(
    resolve(process.cwd(), 'src/services/saleTicketStorage.ts'),
    'utf8',
  );

  assert.match(
    persistence,
    /export async function storeLoadStrict<T>/,
    'persistence must expose a read that propagates storage and JSON failures',
  );
  assert.match(
    ticketStorage,
    /load:\s*\(key\)\s*=>\s*storeLoadStrict<unknown>\(key\)/,
    'policy-enforced ticket writes must load through the strict read boundary',
  );
  assert.match(
    ticketStorage,
    /loadSaleTicketSnapshot[\s\S]*storeLoad<unknown>/,
    'the print screen read-only path may keep tolerant legacy loading',
  );
});

test('storage normalizes operation IDs, rejects blanks, and touches only the exact ticket key', async () => {
  const memory = memoryStorage({
    'sale-ticket:sale-op-other': ticket('sale-op-other', 'local', 25),
  });
  const repository = createSaleTicketSnapshotRepository(memory.storage);

  await repository.saveAuthoritative(ticket('  sale-op-1  ', 'local', 60));
  const loaded = await repository.load(' sale-op-1 ');

  assert.equal(memory.writes.length, 1);
  assert.equal(memory.writes[0].key, 'sale-ticket:sale-op-1');
  assert.equal(memory.writes[0].snapshot.saleId, 'sale-op-1');
  assert.deepEqual(loaded, memory.writes[0].snapshot);
  assert.equal(memory.durable.get('sale-ticket:sale-op-other')?.total, 50);
  assert([...memory.durable.keys()].every((key) => key.startsWith('sale-ticket:')));

  const writesBeforeBlank = memory.writes.length;
  await assert.rejects(
    repository.saveAuthoritative(ticket('   ', 'odoo', 70)),
    /operation id/i,
  );
  assert.equal(await repository.load('   '), null);
  assert.equal(memory.writes.length, writesBeforeBlank);
});
