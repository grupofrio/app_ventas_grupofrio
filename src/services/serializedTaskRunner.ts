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

    transformAndPersist(transform: (state: State) => State): Promise<void> {
      return runSerialized(async () => {
        const durableSnapshot = transform(options.read());
        await options.write(options.select(durableSnapshot));
        options.publish(transform(options.read()));
      });
    },
  };
}
