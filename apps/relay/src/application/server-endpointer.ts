import {
  DEVICE_INPUT_FORMAT,
  VoiceSatelliteError,
  type AudioFrame,
} from "@voice-satellite/contracts";

export type InputStopReason = "speech_end" | "no_speech" | "max_duration";

export interface ServerEndpointerOptions {
  readonly rmsThreshold?: number;
  readonly minimumSpeechMs?: number;
  readonly trailingSilenceMs?: number;
  readonly noSpeechTimeoutMs?: number;
  readonly maximumCaptureMs?: number;
}

export class ServerEndpointer {
  public readonly noSpeechTimeoutMs: number;
  public readonly maximumCaptureMs: number;
  readonly #rmsThreshold: number;
  readonly #minimumSpeechFrames: number;
  readonly #trailingSilenceFrames: number;
  #candidateSpeechFrames = 0;
  #silenceFrames = 0;
  #speechDetected = false;

  public constructor(options: ServerEndpointerOptions = {}) {
    this.#rmsThreshold = positiveInteger(options.rmsThreshold, 700);
    this.#minimumSpeechFrames = millisecondsToFrames(
      positiveInteger(options.minimumSpeechMs, 200),
    );
    this.#trailingSilenceFrames = millisecondsToFrames(
      positiveInteger(options.trailingSilenceMs, 900),
    );
    this.noSpeechTimeoutMs = positiveInteger(options.noSpeechTimeoutMs, 5_000);
    this.maximumCaptureMs = positiveInteger(options.maximumCaptureMs, 15_000);
    if (this.noSpeechTimeoutMs >= this.maximumCaptureMs) {
      throw new Error("no-speech timeout must be shorter than maximum capture");
    }
  }

  public get speechDetected(): boolean {
    return this.#speechDetected;
  }

  public accept(frame: AudioFrame): InputStopReason | undefined {
    const rms = pcm16leRms(frame.data);
    if (rms >= this.#rmsThreshold) {
      this.#candidateSpeechFrames += 1;
      this.#silenceFrames = 0;
      if (this.#candidateSpeechFrames >= this.#minimumSpeechFrames) {
        this.#speechDetected = true;
      }
      return undefined;
    }

    if (!this.#speechDetected) {
      this.#candidateSpeechFrames = 0;
      return undefined;
    }
    this.#silenceFrames += 1;
    return this.#silenceFrames >= this.#trailingSilenceFrames
      ? "speech_end"
      : undefined;
  }
}

function pcm16leRms(data: Uint8Array): number {
  const expectedBytes =
    (DEVICE_INPUT_FORMAT.sampleRateHz *
      DEVICE_INPUT_FORMAT.frameDurationMs *
      DEVICE_INPUT_FORMAT.channels *
      2) /
    1_000;
  if (data.byteLength !== expectedBytes) {
    throw new VoiceSatelliteError(
      "invalid_message",
      `input audio frame must contain ${expectedBytes} bytes`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let sum = 0;
  for (let offset = 0; offset < data.byteLength; offset += 2) {
    const sample = view.getInt16(offset, true);
    sum += sample * sample;
  }
  return Math.sqrt(sum / (data.byteLength / 2));
}

function millisecondsToFrames(milliseconds: number): number {
  return Math.max(
    1,
    Math.ceil(milliseconds / DEVICE_INPUT_FORMAT.frameDurationMs),
  );
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error("endpointer values must be positive integers");
  }
  return resolved;
}
