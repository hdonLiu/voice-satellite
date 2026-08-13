import {
  DEVICE_INPUT_FORMAT,
  type AsrEvent,
  type AudioFrame,
  VoiceSatelliteError,
} from "@voice-satellite/contracts";
import { BoundedAsyncQueue } from "../../../application/bounded-async-queue.js";
import type {
  AsrContext,
  AsrStream,
  StreamingAsrPort,
} from "../../../ports/speech.js";
import { OpenAiHttp, type OpenAiHttpConfig } from "./openai-http.js";
import { pcmS16leToWav } from "./wav.js";

export interface OpenAiAsrConfig extends OpenAiHttpConfig {
  readonly model?: string;
  readonly language?: string;
  readonly maxAudioBytes?: number;
}

export class OpenAiTranscriptionAsr implements StreamingAsrPort {
  readonly #http: OpenAiHttp;

  public constructor(private readonly config: OpenAiAsrConfig) {
    this.#http = new OpenAiHttp(config);
  }

  public async open(
    _context: AsrContext,
    signal: AbortSignal,
  ): Promise<AsrStream> {
    return new BufferedTranscriptionStream(this.#http, this.config, signal);
  }
}

class BufferedTranscriptionStream implements AsrStream {
  readonly #events = new BoundedAsyncQueue<AsrEvent>(2);
  readonly #chunks: Uint8Array[] = [];
  readonly #abort = new AbortController();
  #bytes = 0;
  #finished = false;

  public readonly events: AsyncIterable<AsrEvent> = this.#events;

  public constructor(
    private readonly http: OpenAiHttp,
    private readonly config: OpenAiAsrConfig,
    outerSignal: AbortSignal,
  ) {
    outerSignal.addEventListener(
      "abort",
      () => this.#abort.abort(outerSignal.reason),
      { once: true },
    );
  }

  public async push(frame: AudioFrame): Promise<void> {
    if (this.#finished)
      throw new VoiceSatelliteError("invalid_state", "ASR stream is finished");
    const nextBytes = this.#bytes + frame.data.byteLength;
    if (nextBytes > (this.config.maxAudioBytes ?? 8 * 1024 * 1024)) {
      throw new VoiceSatelliteError(
        "backpressure",
        "captured audio exceeds configured limit",
      );
    }
    this.#chunks.push(frame.data.slice());
    this.#bytes = nextBytes;
  }

  public async finish(): Promise<void> {
    if (this.#finished) return;
    this.#finished = true;
    try {
      if (this.#bytes === 0)
        throw new VoiceSatelliteError(
          "invalid_message",
          "no audio was captured",
        );
      const pcm = concat(this.#chunks, this.#bytes);
      const wav = pcmS16leToWav(
        pcm,
        DEVICE_INPUT_FORMAT.sampleRateHz,
        DEVICE_INPUT_FORMAT.channels,
      );
      const form = new FormData();
      form.append(
        "file",
        new Blob([wav.slice().buffer as ArrayBuffer], { type: "audio/wav" }),
        "turn.wav",
      );
      form.append("model", this.config.model ?? "gpt-4o-mini-transcribe");
      form.append("response_format", "json");
      if (this.config.language) form.append("language", this.config.language);
      const response = await this.http.request("/audio/transcriptions", {
        method: "POST",
        body: form,
        signal: this.#abort.signal,
      });
      const body = (await response.json()) as { text?: unknown };
      if (typeof body.text !== "string" || body.text.trim().length === 0) {
        throw new VoiceSatelliteError(
          "invalid_message",
          "speech provider returned no transcript",
        );
      }
      await this.#events.push({ type: "final", text: body.text.trim() });
      this.#events.close();
    } catch (error) {
      this.#events.fail(error);
      throw error;
    }
  }

  public async cancel(): Promise<void> {
    this.#abort.abort(new DOMException("ASR cancelled", "AbortError"));
    this.#events.close();
  }
}

function concat(chunks: readonly Uint8Array[], bytes: number): Uint8Array {
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
