import assert from 'node:assert/strict';
import test from 'node:test';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  buildExchangeTicketSnapshot,
  getExchangeTicketStorageKey,
} from '../src/services/exchangeTicket.ts';
import {
  loadExchangeTicketSnapshot,
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
