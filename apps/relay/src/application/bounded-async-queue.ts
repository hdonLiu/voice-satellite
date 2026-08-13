import { VoiceSatelliteError } from "@voice-satellite/contracts";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("operation aborted", "AbortError");
}

export class BoundedAsyncQueue<T> implements AsyncIterable<T> {
  readonly #items: T[] = [];
  readonly #readers: Deferred<IteratorResult<T>>[] = [];
  readonly #writers: Deferred<void>[] = [];
  #closed = false;
  #failure: unknown;

  public constructor(public readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("queue capacity must be a positive safe integer");
    }
  }

  public get size(): number {
    return this.#items.length;
  }

  public async push(item: T, signal?: AbortSignal): Promise<void> {
    while (this.#items.length >= this.capacity) {
      this.#throwIfClosed();
      if (signal?.aborted) {
        throw abortError(signal);
      }

      const writer = deferred<void>();
      this.#writers.push(writer);
      const onAbort = (): void => writer.reject(abortError(signal!));
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await writer.promise;
      } finally {
        signal?.removeEventListener("abort", onAbort);
        const index = this.#writers.indexOf(writer);
        if (index >= 0) {
          this.#writers.splice(index, 1);
        }
      }
    }

    this.#throwIfClosed();
    const reader = this.#readers.shift();
    if (reader) {
      reader.resolve({ done: false, value: item });
      return;
    }
    this.#items.push(item);
  }

  public close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const reader of this.#readers.splice(0)) {
      reader.resolve({ done: true, value: undefined });
    }
    const error = new VoiceSatelliteError("invalid_state", "queue is closed");
    for (const writer of this.#writers.splice(0)) {
      writer.reject(error);
    }
  }

  public fail(error: unknown): void {
    if (this.#closed) {
      return;
    }
    this.#failure = error;
    this.#closed = true;
    this.#items.splice(0);
    for (const reader of this.#readers.splice(0)) {
      reader.reject(error);
    }
    for (const writer of this.#writers.splice(0)) {
      writer.reject(error);
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.#next(),
    };
  }

  async #next(): Promise<IteratorResult<T>> {
    if (this.#items.length > 0) {
      const value = this.#items.shift()!;
      this.#writers.shift()?.resolve();
      return { done: false, value };
    }
    if (this.#failure !== undefined) {
      throw this.#failure;
    }
    if (this.#closed) {
      return { done: true, value: undefined };
    }

    const reader = deferred<IteratorResult<T>>();
    this.#readers.push(reader);
    return reader.promise;
  }

  #throwIfClosed(): void {
    if (this.#failure !== undefined) {
      throw this.#failure;
    }
    if (this.#closed) {
      throw new VoiceSatelliteError("invalid_state", "queue is closed");
    }
  }
}
