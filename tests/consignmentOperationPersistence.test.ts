import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

type OperationKind = 'create' | 'visit' | 'close';

interface PendingOperations {
  create?: string;
  visit?: string;
  close?: string;
}

interface PersistenceLogic {
  decodePendingOperations(raw: string | null, sessionId: string): PendingOperations | null;
  withPendingOperation(
    operations: PendingOperations,
    kind: OperationKind,
    operationId: string,
  ): PendingOperations;
  withoutPendingOperation(operations: PendingOperations, kind: OperationKind): PendingOperations;
}

async function loadPersistenceLogic(): Promise<PersistenceLogic> {
  try {
    return await import('../src/services/consignmentOperationPersistenceLogic.ts') as PersistenceLogic;
  } catch {
    assert.fail('consignment pending-operation persistence logic must exist');
  }
}

test('consignment operation ids survive restart only within the authenticated session', async () => {
  const persistence = await loadPersistenceLogic();
  const afterCreate = persistence.withPendingOperation(
    {},
    'create',
    '01234567-89ab-4cde-8fab-0123456789ab',
  );
  const afterVisit = persistence.withPendingOperation(
    afterCreate,
    'visit',
    'fedcba98-7654-4321-8fed-cba987654321',
  );
  const serialized = JSON.stringify({ version: 1, sessionId: 'session-a', operations: afterVisit });

  assert.deepEqual(persistence.decodePendingOperations(serialized, 'session-a'), afterVisit);
  assert.equal(persistence.decodePendingOperations(serialized, 'session-b'), null);
  assert.equal(persistence.decodePendingOperations('{not-json', 'session-a'), null);
});

test('consignment operation identity remains until its matching confirmed success', async () => {
  const persistence = await loadPersistenceLogic();
  const pending = persistence.withPendingOperation(
    { create: '01234567-89ab-4cde-8fab-0123456789ab' },
    'close',
    'fedcba98-7654-4321-8fed-cba987654321',
  );

  assert.deepEqual(persistence.withoutPendingOperation(pending, 'visit'), pending);
  assert.deepEqual(persistence.withoutPendingOperation(pending, 'close'), {
    create: '01234567-89ab-4cde-8fab-0123456789ab',
  });
});

test('consignment persistence uses encrypted storage and never plaintext AsyncStorage', () => {
  let source = '';
  try {
    source = readFileSync(resolve('src/services/consignmentOperationPersistence.ts'), 'utf8');
  } catch {
    assert.fail('consignment pending-operation encrypted storage module must exist');
  }
  assert.match(source, /from ['"]expo-secure-store['"]/, 'pending operation ids must use SecureStore');
  assert.doesNotMatch(source, /AsyncStorage/, 'pending operation ids must never use plaintext AsyncStorage');
});

test('consignment persists an operation id before dispatch and clears it only after success', () => {
  const screen = readFileSync(resolve('app/consignment/[stopId].tsx'), 'utf8');

  assert.match(screen, /await getConsignmentPendingOperationId\('create'\)/, 'create must persist or restore its id before dispatch');
  assert.match(screen, /await clearConsignmentPendingOperationId\('create'\)/, 'create clears only after its request resolves');
  assert.match(screen, /await getConsignmentPendingOperationId\(closing \? 'close' : 'visit'\)/, 'visit/close must restore their operation ids before dispatch');
  assert.match(screen, /await clearConsignmentPendingOperationId\(closing \? 'close' : 'visit'\)/, 'visit/close clear only after their request resolves');
});
