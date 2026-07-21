export function createSerializedTaskRunner() {
  let tail: Promise<void> = Promise.resolve();
  return function runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

interface SerializedPersistenceOptions<State, Persisted> {
  read: () => State;
  select: (state: State) => Persisted;
  write: (snapshot: Persisted) => Promise<void>;
  publish: (state: State) => void;
}

export function createSerializedPersistenceCoordinator<State, Persisted>(
  options: SerializedPersistenceOptions<State, Persisted>,
) {
  const runSerialized = createSerializedTaskRunner();

  return {
    persistCurrent(): Promise<void> {
      return runSerialized(async () => {
        await options.write(options.select(options.read()));
      });
    },

    /**
     * Persists a transformed snapshot, then reapplies the same transformation
     * to the current state before publishing it. On a successful write,
     * `transform` is therefore invoked twice: once before the write to build the
     * durable snapshot, and once after the write against the then-current state.
     *
     * @param transform A pure, deterministic, idempotent transformation with no
     * side effects. It must be safe to invoke twice for one successful operation.
     */
    transformAndPersist(transform: (state: State) => State): Promise<void> {
      return runSerialized(async () => {
        const durableSnapshot = transform(options.read());
        await options.write(options.select(durableSnapshot));
        options.publish(transform(options.read()));
      });
    },
  };
}
