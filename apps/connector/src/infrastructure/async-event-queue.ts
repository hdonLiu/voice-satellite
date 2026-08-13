export class AsyncEventQueue<T> implements AsyncIterable<T> {
  readonly #items: T[] = [];
  readonly #readers: Array<{
    resolve(value: IteratorResult<T>): void;
    reject(error: unknown): void;
  }> = [];
  #closed = false;
  #error: unknown;

  public push(item: T): void {
    if (this.#closed) return;
    const reader = this.#readers.shift();
    if (reader) reader.resolve({ done: false, value: item });
    else this.#items.push(item);
  }

  public close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const reader of this.#readers.splice(0))
      reader.resolve({ done: true, value: undefined });
  }

  public fail(error: unknown): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#error = error;
    for (const reader of this.#readers.splice(0)) reader.reject(error);
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const item = this.#items.shift();
        if (item !== undefined) return { done: false, value: item };
        if (this.#error !== undefined) throw this.#error;
        if (this.#closed) return { done: true, value: undefined };
        return new Promise<IteratorResult<T>>((resolve, reject) =>
          this.#readers.push({ resolve, reject }),
        );
      },
    };
  }
}
