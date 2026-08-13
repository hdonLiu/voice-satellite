import type { RequestId } from "@voice-satellite/contracts";

export interface RequestDedupeOptions {
  readonly maxEntries: number;
  readonly ttlMs: number;
  readonly now?: () => number;
}

export class RequestDedupeCache {
  readonly #entries = new Map<RequestId, number>();
  readonly #now: () => number;

  public constructor(private readonly options: RequestDedupeOptions) {
    if (options.maxEntries < 1 || options.ttlMs < 1) {
      throw new RangeError("dedupe cache limits must be positive");
    }
    this.#now = options.now ?? Date.now;
  }

  public has(requestId: RequestId): boolean {
    this.#prune();
    return this.#entries.has(requestId);
  }

  public add(requestId: RequestId): void {
    this.#prune();
    this.#entries.delete(requestId);
    this.#entries.set(requestId, this.#now() + this.options.ttlMs);
    while (this.#entries.size > this.options.maxEntries) {
      const oldest = this.#entries.keys().next().value as RequestId | undefined;
      if (!oldest) {
        break;
      }
      this.#entries.delete(oldest);
    }
  }

  #prune(): void {
    const now = this.#now();
    for (const [requestId, expiresAt] of this.#entries) {
      if (expiresAt > now) {
        continue;
      }
      this.#entries.delete(requestId);
    }
  }
}
