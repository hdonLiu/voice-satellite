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
import { pcmS16leToWav } from "../openai/wav.js";

export interface WhisperCppAsrConfig {
  readonly baseUrl?: string;
  readonly language?: string;
  readonly maxAudioBytes?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class WhisperCppAsr implements StreamingAsrPort {
  public constructor(private readonly config: WhisperCppAsrConfig = {}) {}

  public async open(
    _context: AsrContext,
    signal: AbortSignal,
  ): Promise<AsrStream> {
    return new WhisperCppStream(this.config, signal);
  }
}

class WhisperCppStream implements AsrStream {
  readonly #events = new BoundedAsyncQueue<AsrEvent>(2);
  readonly #chunks: Uint8Array[] = [];
  readonly #abort = new AbortController();
  #bytes = 0;
  #finished = false;

  public readonly events: AsyncIterable<AsrEvent> = this.#events;

  public constructor(
    private readonly config: WhisperCppAsrConfig,
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
      form.append("response_format", "json");
      form.append("language", this.config.language ?? "zh");
      const baseUrl = (this.config.baseUrl ?? "http://whisper:8080").replace(
        /\/$/,
        "",
      );
      let response: Response;
      try {
        response = await (this.config.fetch ?? globalThis.fetch)(
          `${baseUrl}/inference`,
          {
            method: "POST",
            body: form,
            signal: this.#abort.signal,
          },
        );
      } catch (error) {
        throw new VoiceSatelliteError(
          "internal",
          "whisper.cpp request failed",
          { cause: error },
        );
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 512);
        throw new VoiceSatelliteError(
          response.status === 408 || response.status >= 500
            ? "timeout"
            : "internal",
          `whisper.cpp returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }
      const body = (await response.json()) as { text?: unknown };
      if (typeof body.text !== "string" || body.text.trim().length === 0) {
        throw new VoiceSatelliteError(
          "invalid_message",
          "whisper.cpp returned no transcript",
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
