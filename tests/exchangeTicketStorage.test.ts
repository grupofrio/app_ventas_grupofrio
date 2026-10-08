import assert from 'node:assert/strict';
import test from 'node:test';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  buildExchangeTicketSnapshot,
  getExchangeTicketStorageKey,
} from '../src/services/exchangeTicket.ts';
import {
  EXCHANGE_TICKET_INDEX_KEY,
  listExchangeTicketSnapshots,
  loadExchangeTicketSnapshot,
  recordExchangeServerIdentity,
  saveExchangeTicketSnapshot,
} from '../src/services/exchangeTicketStorage.ts';

test('exchange ticket storage uses the exact namespaced key', () => {
  assert.equal(
    getExchangeTicketStorageKey('idempotency-123'),
    'exchange-ticket:idempotency-123',
  );
});

test('exchange ticket storage round-trips a snapshot through AsyncStorage', async () => {
  const backingStore = new Map<string, string>();
  const originalSetItem = AsyncStorage.setItem;
  const originalGetItem = AsyncStorage.getItem;

  AsyncStorage.setItem = async (key: string, value: string) => {
    backingStore.set(key, value);
  };
  AsyncStorage.getItem = async (key: string) => backingStore.get(key) ?? null;

  try {
    const snapshot = buildExchangeTicketSnapshot({
      snapshotId: 'idempotency-123',
      exchangeName: '',
      exchangeId: null,
      customerName: 'Abarrotes La Esperanza',
      createdAt: '2026-07-27T20:35:00.000Z',
      deliveryLines: [
        { productId: 10, productName: 'Coca Cola 600 ml', qty: 2 },
      ],
      mermaLines: [
        { productId: 11, productName: 'Agua 1 L', qty: 1 },
      ],
      notes: 'Envases dañados',
    });

    await saveExchangeTicketSnapshot(snapshot);
    const loaded = await loadExchangeTicketSnapshot('idempotency-123');

    assert.deepEqual(loaded, snapshot);
  } finally {
    AsyncStorage.setItem = originalSetItem;
    AsyncStorage.getItem = originalGetItem;
  }
});

test('exchange ticket index lists newest snapshots and survives an index write failure', async () => {
  const backingStore = new Map<string, string>();
  const originalSetItem = AsyncStorage.setItem;
  const originalGetItem = AsyncStorage.getItem;
  let failIndexWrite = false;

  AsyncStorage.setItem = async (key: string, value: string) => {
    if (failIndexWrite && key.includes(EXCHANGE_TICKET_INDEX_KEY)) {
      throw new Error('index unavailable');
    }
    backingStore.set(key, value);
  };
  AsyncStorage.getItem = async (key: string) => backingStore.get(key) ?? null;

  try {
    const older = buildExchangeTicketSnapshot({
      snapshotId: 'older-change',
      exchangeName: 'Nuevo',
      exchangeId: 10,
      customerName: 'Cliente viejo',
      createdAt: '2026-07-27T20:35:00.000Z',
      deliveryLines: [],
      mermaLines: [],
      operationStatus: 'confirmed',
    });
    const newer = buildExchangeTicketSnapshot({
      snapshotId: 'newer-change',
      exchangeName: 'PENDIENTE/newer-ch',
      exchangeId: null,
      customerName: 'Cliente nuevo',
      createdAt: '2026-07-28T20:35:00.000Z',
      deliveryLines: [],
      mermaLines: [],
      operationStatus: 'pending',
    });

    await saveExchangeTicketSnapshot(older);
    await saveExchangeTicketSnapshot(newer);
    const listed = await listExchangeTicketSnapshots();
    assert.deepEqual(listed.map((ticket) => ticket.snapshotId), ['newer-change', 'older-change']);
    assert.equal(listed[1].folio, 'CAMBIO-10');

    await recordExchangeServerIdentity('newer-change', {
      exchangeName: 'CAM/2026/00077',
      exchangeId: 77,
    });
    const confirmed = await loadExchangeTicketSnapshot('newer-change');
    assert.equal(confirmed?.folio, 'CAM/2026/00077');
    assert.equal(confirmed?.operationStatus, 'confirmed');

    await recordExchangeServerIdentity('missing-change', {
      exchangeName: 'CAM/2026/00001',
      exchangeId: 1,
    });

    failIndexWrite = true;
    await saveExchangeTicketSnapshot(buildExchangeTicketSnapshot({
      snapshotId: 'unindexed-change',
      exchangeName: '',
      exchangeId: null,
      customerName: 'Cliente',
      createdAt: '2026-07-29T20:35:00.000Z',
      deliveryLines: [],
      mermaLines: [],
    }));
    const unindexed = await loadExchangeTicketSnapshot('unindexed-change');
    assert.equal(unindexed?.snapshotId, 'unindexed-change');
  } finally {
    AsyncStorage.setItem = originalSetItem;
    AsyncStorage.getItem = originalGetItem;
  }
});

test('saveExchangeTicketSnapshot propagates AsyncStorage rejection', async () => {
  const originalSetItem = AsyncStorage.setItem;
  const failure = new Error('storage unavailable');

  AsyncStorage.setItem = async () => {
    throw failure;
  };

  try {
    await assert.rejects(
      saveExchangeTicketSnapshot(buildExchangeTicketSnapshot({
        snapshotId: 'idempotency-123',
        exchangeName: '',
        exchangeId: null,
        customerName: 'Abarrotes La Esperanza',
        createdAt: '2026-07-27T20:35:00.000Z',
        deliveryLines: [],
        mermaLines: [],
      })),
      failure,
    );
  } finally {
    AsyncStorage.setItem = originalSetItem;
  }
});
