export async function nextWithSignal<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) {
    throw signal.reason;
  }

  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
