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
