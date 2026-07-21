export function createSerializedTaskRunner() {
  let tail: Promise<void> = Promise.resolve();
  return function runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
