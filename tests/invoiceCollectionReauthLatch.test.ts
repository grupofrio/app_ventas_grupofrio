import assert from 'node:assert/strict';
import test from 'node:test';

interface Session {
  companyId: number;
  employeeId: number;
  sessionId: string;
}

interface LatchModule {
  createInvoiceCollectionReauthLatch(driver: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  }): {
    isRequired(session: Session): Promise<boolean>;
    markRequired(session: Session): Promise<void>;
    clear(session: Session): Promise<void>;
  };
  retireAndClearInvoiceCollectionSessionState(deps: {
    retireProcessor(): Promise<void>;
    clearPreEnvelopeState?(): Promise<void>;
    clearEncryptedSession(): Promise<void>;
    clearReauthenticationLatch(): Promise<void>;
  }): Promise<void>;
}

test('the durable reauth latch is scoped to the exact principal session and stores no collection data', async () => {
  const mod = await import('../src/services/invoiceCollectionReauthLatchLogic.ts') as unknown as LatchModule;
  const records = new Map<string, string>();
  const writes: Array<{ key: string; value: string }> = [];
  const latch = mod.createInvoiceCollectionReauthLatch({
    async get(key) { return records.get(key) ?? null; },
    async set(key, value) {
      writes.push({ key, value });
      records.set(key, value);
    },
    async remove(key) { records.delete(key); },
  });
  const session = { companyId: 7, employeeId: 19, sessionId: 'old-session' };

  await latch.markRequired(session);

  assert.equal(await latch.isRequired(session), true);
  assert.equal(await latch.isRequired({ ...session, sessionId: 'new-session' }), false);
  assert.equal(await latch.isRequired({ ...session, employeeId: 20 }), false);
  assert.equal(await latch.isRequired({ ...session, companyId: 8 }), false);
  assert.equal(writes.length, 1);
  assert.doesNotMatch(JSON.stringify(writes), /invoice|amount|payment|stop|operation/i);

  await latch.clear(session);
  assert.equal(await latch.isRequired(session), false);
});

test('session cleanup preserves the reauth latch when encrypted-envelope deletion fails', async () => {
  const mod = await import('../src/services/invoiceCollectionReauthLatchLogic.ts') as unknown as LatchModule;
  const events: string[] = [];

  await assert.rejects(() => mod.retireAndClearInvoiceCollectionSessionState({
    async retireProcessor() { events.push('retire'); },
    async clearPreEnvelopeState() { events.push('legacy'); },
    async clearEncryptedSession() {
      events.push('envelope');
      throw new Error('encrypted envelope deletion failed');
    },
    async clearReauthenticationLatch() { events.push('latch'); },
  }), /encrypted envelope deletion failed/);

  assert.deepEqual(
    events,
    ['retire', 'legacy', 'envelope'],
    'legacy state clears first, while the latch survives as long as the old intent envelope survives',
  );
});
