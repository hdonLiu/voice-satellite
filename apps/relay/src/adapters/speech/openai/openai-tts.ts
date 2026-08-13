import {
  DEVICE_OUTPUT_FORMAT,
  type AudioFrame,
  newId,
  VoiceSatelliteError,
} from "@voice-satellite/contracts";
import { BoundedAsyncQueue } from "../../../application/bounded-async-queue.js";
import type {
  StreamingTtsPort,
  TtsContext,
  TtsStream,
} from "../../../ports/speech.js";
import { OpenAiHttp, type OpenAiHttpConfig } from "./openai-http.js";

export interface OpenAiTtsConfig extends OpenAiHttpConfig {
  readonly model?: string;
  readonly voice?: string;
  readonly instructions?: string;
  readonly queueFrames?: number;
}

export class OpenAiPcmTts implements StreamingTtsPort {
  readonly #http: OpenAiHttp;

  public constructor(private readonly config: OpenAiTtsConfig) {
    this.#http = new OpenAiHttp(config);
  }

  public async open(
    _context: TtsContext,
    signal: AbortSignal,
  ): Promise<TtsStream> {
    return new OpenAiPcmTtsStream(this.#http, this.config, signal);
  }
}

class OpenAiPcmTtsStream implements TtsStream {
  readonly #queue: BoundedAsyncQueue<AudioFrame>;
  readonly #abort = new AbortController();
  readonly #streamId = newId<"AudioStreamId">();
  #sequence = 0;
  #finished = false;

  public readonly audio: AsyncIterable<AudioFrame>;

  public constructor(
    private readonly http: OpenAiHttp,
    private readonly config: OpenAiTtsConfig,
    outerSignal: AbortSignal,
  ) {
    this.#queue = new BoundedAsyncQueue(config.queueFrames ?? 100);
    this.audio = this.#queue;
    outerSignal.addEventListener(
      "abort",
      () => this.#abort.abort(outerSignal.reason),
      { once: true },
    );
  }

  public async append(segment: string): Promise<void> {
    if (this.#finished)
      throw new VoiceSatelliteError("invalid_state", "TTS stream is finished");
    const text = segment.trim();
    if (!text) return;
    const body: Record<string, string> = {
      model: this.config.model ?? "gpt-4o-mini-tts",
      voice: this.config.voice ?? "alloy",
      input: text,
      response_format: "pcm",
    };
    if (this.config.instructions) body.instructions = this.config.instructions;
    const response = await this.http.request("/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: this.#abort.signal,
    });
    if (!response.body)
      throw new VoiceSatelliteError(
        "internal",
        "speech provider returned no audio body",
      );
    await this.#frameResponse(response.body);
  }

  public async finish(): Promise<void> {
    if (this.#finished) return;
    this.#finished = true;
    this.#queue.close();
  }

  public async cancel(): Promise<void> {
    this.#finished = true;
    this.#abort.abort(new DOMException("TTS cancelled", "AbortError"));
    this.#queue.close();
  }

  async #frameResponse(body: ReadableStream<Uint8Array>): Promise<void> {
    const frameBytes =
      (DEVICE_OUTPUT_FORMAT.sampleRateHz *
        DEVICE_OUTPUT_FORMAT.channels *
        2 *
        20) /
      1000;
    let pending = new Uint8Array(0);
    for await (const chunk of body) {
      const combined = new Uint8Array(pending.byteLength + chunk.byteLength);
      combined.set(pending);
      combined.set(chunk, pending.byteLength);
      let offset = 0;
      while (combined.byteLength - offset >= frameBytes) {
        await this.#emit(combined.slice(offset, offset + frameBytes));
        offset += frameBytes;
      }
      pending = combined.slice(offset);
    }
    if (pending.byteLength > 0) {
      const padded = new Uint8Array(frameBytes);
      padded.set(pending);
      await this.#emit(padded);
    }
  }

  async #emit(data: Uint8Array): Promise<void> {
    const sequence = this.#sequence++;
    await this.#queue.push(
      { streamId: this.#streamId, sequence, timestampMs: sequence * 20, data },
      this.#abort.signal,
    );
  }
}
