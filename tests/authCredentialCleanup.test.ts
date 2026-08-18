import assert from 'node:assert/strict';
import test from 'node:test';

interface CleanupModule {
  deleteAllAuthCredentialKeys(
    keys: readonly string[],
    deleteKey: (key: string) => Promise<void>,
  ): Promise<void>;
  commitAuthStateBeforeSync(deps: {
    persist(): Promise<void>;
    rollback(): Promise<void>;
    resume(): void;
  }): Promise<void>;
  replaceAuthCredentialValues(
    updates: readonly { key: string; value: string | null }[],
    driver: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string): Promise<void>;
      remove(key: string): Promise<void>;
    },
  ): Promise<void>;
}

test('credential cleanup attempts every key before propagating any deletion failure', async () => {
  const mod = await import('../src/services/authCredentialCleanup.ts') as CleanupModule;
  const keys = ['legacy', 'token', 'session', 'base-url'];

  for (const failingKey of keys) {
    const attempts: string[] = [];
    await assert.rejects(() => mod.deleteAllAuthCredentialKeys(keys, async (key) => {
      attempts.push(key);
      if (key === failingKey) throw new Error(`failed:${key}`);
    }), new RegExp(`failed:${failingKey}`));
    assert.deepEqual(attempts, keys, `failure at ${failingKey} must not skip later credential keys`);
  }
});

test('an auth-state persistence failure rolls back and never resumes collection sync', async () => {
  const mod = await import('../src/services/authCredentialCleanup.ts') as CleanupModule;
  const events: string[] = [];

  await assert.rejects(() => mod.commitAuthStateBeforeSync({
    async persist() {
      events.push('persist');
      throw new Error('AUTH_STATE write failed');
    },
    async rollback() { events.push('rollback'); },
    resume() { events.push('resume'); },
  }), /AUTH_STATE write failed/);

  assert.deepEqual(events, ['persist', 'rollback']);
});

test('a partial credential rotation restores the exact previous token and session scope', async () => {
  const mod = await import('../src/services/authCredentialCleanup.ts') as CleanupModule;
  const updates = [
    { key: 'token', value: 'new-token' },
    { key: 'legacy', value: null },
    { key: 'session', value: 'new-session' },
  ] as const;

  for (const failingKey of updates.map(({ key }) => key)) {
    const records = new Map([
      ['token', 'old-token'],
      ['legacy', 'old-legacy'],
      ['session', 'old-session'],
    ]);
    let injected = false;
    await assert.rejects(() => mod.replaceAuthCredentialValues(updates, {
      async get(key) { return records.get(key) ?? null; },
      async set(key, value) {
        if (key === failingKey && !injected) {
          injected = true;
          throw new Error(`failed:${key}`);
        }
        records.set(key, value);
      },
      async remove(key) {
        if (key === failingKey && !injected) {
          injected = true;
          throw new Error(`failed:${key}`);
        }
        records.delete(key);
      },
    }), new RegExp(`failed:${failingKey}`));

    assert.deepEqual(Object.fromEntries(records), {
      token: 'old-token',
      legacy: 'old-legacy',
      session: 'old-session',
    });
  }
});
