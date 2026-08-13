import { describe, expect, it } from "vitest";
import {
  AUDIO_WIRE_HEADER_BYTES,
  AudioWireError,
  asId,
  decodeAudioWireFrame,
  encodeAudioWireFrame,
} from "../src/index.js";

describe("audio wire v1", () => {
  it("round trips a binary audio frame", () => {
    const encoded = encodeAudioWireFrame({
      direction: "input",
      sequence: 42,
      timestampMs: 1_725_000_000_123,
      streamId: asId<"AudioStreamId">("00112233-4455-6677-8899-aabbccddeeff"),
      payload: Uint8Array.of(1, 2, 3, 4),
    });

    expect(encoded).toHaveLength(AUDIO_WIRE_HEADER_BYTES + 4);
    expect(decodeAudioWireFrame(encoded)).toEqual({
      direction: "input",
      sequence: 42,
      timestampMs: 1_725_000_000_123,
      streamId: "00112233-4455-6677-8899-aabbccddeeff",
      payload: Uint8Array.of(1, 2, 3, 4),
    });
  });

  it("fails closed on truncation and trailing bytes", () => {
    const valid = encodeAudioWireFrame({
      direction: "output",
      sequence: 0,
      timestampMs: 0,
      streamId: asId<"AudioStreamId">("00112233-4455-6677-8899-aabbccddeeff"),
      payload: Uint8Array.of(7),
    });
    expect(() => decodeAudioWireFrame(valid.subarray(0, -1))).toThrow(
      AudioWireError,
    );
    const trailing = new Uint8Array(valid.byteLength + 1);
    trailing.set(valid);
    expect(() => decodeAudioWireFrame(trailing)).toThrow(AudioWireError);
  });
});
