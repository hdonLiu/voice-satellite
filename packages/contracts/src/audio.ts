import type { AudioStreamId } from "./ids.js";

export const DEVICE_INPUT_FORMAT = Object.freeze({
  encoding: "pcm_s16le",
  sampleRateHz: 16_000,
  channels: 1,
  frameDurationMs: 20,
} as const);

export const DEVICE_OUTPUT_FORMAT = Object.freeze({
  encoding: "pcm_s16le",
  sampleRateHz: 24_000,
  channels: 1,
} as const);

export interface AudioFrame {
  readonly streamId: AudioStreamId;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly data: Uint8Array;
}
