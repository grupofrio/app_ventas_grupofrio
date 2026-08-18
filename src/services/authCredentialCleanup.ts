/** Attempts every independent credential deletion, then propagates the first failure. */
export async function deleteAllAuthCredentialKeys(
  keys: readonly string[],
  deleteKey: (key: string) => Promise<void>,
): Promise<void> {
  let firstFailure: unknown;
  for (const key of keys) {
    try {
      await deleteKey(key);
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) throw firstFailure;
}

export async function commitAuthStateBeforeSync(deps: {
  persist(): Promise<void>;
  rollback(): Promise<void>;
  resume(): void;
}): Promise<void> {
  try {
    await deps.persist();
  } catch (error) {
    try {
      await deps.rollback();
    } finally {
      throw error;
    }
  }
  deps.resume();
}

export async function replaceAuthCredentialValues(
  updates: readonly { key: string; value: string | null }[],
  driver: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  },
): Promise<void> {
  const previous: Array<{ key: string; value: string | null }> = [];
  for (const { key } of updates) previous.push({ key, value: await driver.get(key) });
  const apply = async ({ key, value }: { key: string; value: string | null }) => {
    if (value === null) await driver.remove(key);
    else await driver.set(key, value);
  };
  try {
    for (const update of updates) await apply(update);
  } catch (error) {
    // Restore every prior value independently. If storage also fails during
    // compensation there is no atomic SecureStore primitive to claim success.
    for (const prior of previous) {
      try { await apply(prior); } catch { /* keep compensating remaining keys */ }
    }
    throw error;
  }
}
