export interface SentenceSegmenterOptions {
  readonly minCharacters: number;
  readonly maxCharacters: number;
}

const DEFAULT_OPTIONS: SentenceSegmenterOptions = {
  minCharacters: 8,
  maxCharacters: 80,
};

const STRONG_BOUNDARY = /[。！？!?；;.\n]/u;
const SOFT_BOUNDARY = /[，,：:]\s*$/u;

export class SentenceSegmenter {
  readonly #options: SentenceSegmenterOptions;
  #buffer = "";

  public constructor(options: Partial<SentenceSegmenterOptions> = {}) {
    this.#options = { ...DEFAULT_OPTIONS, ...options };
    if (
      this.#options.minCharacters < 1 ||
      this.#options.maxCharacters < this.#options.minCharacters
    ) {
      throw new RangeError("invalid sentence segmenter limits");
    }
  }

  public append(delta: string): string[] {
    if (delta.length === 0) {
      return [];
    }
    this.#buffer += delta;
    return this.#drain(false);
  }

  public flush(): string[] {
    return this.#drain(true);
  }

  #drain(flush: boolean): string[] {
    const segments: string[] = [];
    while (this.#buffer.length > 0) {
      const strongIndex = this.#findStrongBoundary();
      if (strongIndex >= 0) {
        segments.push(this.#take(strongIndex + 1));
        continue;
      }

      if (this.#buffer.length >= this.#options.maxCharacters) {
        const candidate = this.#buffer.slice(0, this.#options.maxCharacters);
        const softIndex = Math.max(
          candidate.search(SOFT_BOUNDARY),
          candidate.lastIndexOf(" "),
        );
        const length =
          softIndex + 1 >= this.#options.minCharacters
            ? softIndex + 1
            : this.#options.maxCharacters;
        segments.push(this.#take(length));
        continue;
      }

      if (flush) {
        const tail = this.#take(this.#buffer.length);
        if (tail.length > 0) {
          segments.push(tail);
        }
      }
      break;
    }
    return segments;
  }

  #findStrongBoundary(): number {
    for (
      let index = this.#options.minCharacters - 1;
      index < this.#buffer.length;
      index++
    ) {
      if (STRONG_BOUNDARY.test(this.#buffer[index]!)) {
        return index;
      }
    }
    return -1;
  }

  #take(length: number): string {
    const value = this.#buffer.slice(0, length).trim();
    this.#buffer = this.#buffer.slice(length).trimStart();
    return value;
  }
}
