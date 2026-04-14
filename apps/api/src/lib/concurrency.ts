export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  if (workerCount <= 1) {
    for (let index = 0; index < items.length; index += 1) {
      if (signal?.aborted) {
        break;
      }
      const item = items[index];
      if (item !== undefined) {
        await worker(item, index);
      }
    }
    return;
  }

  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      if (signal?.aborted) {
        break;
      }
      const index = nextIndex++;
      const item = items[index];
      if (item !== undefined) {
        await worker(item, index);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}
