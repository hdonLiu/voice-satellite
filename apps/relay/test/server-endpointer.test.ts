import {
  asId,
  type AudioFrame,
  VoiceSatelliteError,
} from "@voice-satellite/contracts";
import { describe, expect, it } from "vitest";
import { ServerEndpointer } from "../src/application/server-endpointer.js";

describe("ServerEndpointer", () => {
  it("ends input after sustained speech followed by trailing silence", () => {
    const endpointer = new ServerEndpointer({
      rmsThreshold: 500,
      minimumSpeechMs: 40,
      trailingSilenceMs: 60,
    });

    expect(endpointer.accept(frame(0, 1_000))).toBeUndefined();
    expect(endpointer.accept(frame(1, 1_000))).toBeUndefined();
    expect(endpointer.speechDetected).toBe(true);
    expect(endpointer.accept(frame(2, 0))).toBeUndefined();
    expect(endpointer.accept(frame(3, 0))).toBeUndefined();
    expect(endpointer.accept(frame(4, 0))).toBe("speech_end");
  });

  it("rejects audio that does not match the baseline input frame", () => {
    const endpointer = new ServerEndpointer();
    expect(() =>
      endpointer.accept({ ...frame(0, 0), data: new Uint8Array(10) }),
    ).toThrow(VoiceSatelliteError);
  });
});

function frame(sequence: number, amplitude: number): AudioFrame {
  const data = new Uint8Array(640);
  const view = new DataView(data.buffer);
  for (let offset = 0; offset < data.byteLength; offset += 2) {
    view.setInt16(offset, amplitude, true);
  }
  return {
    streamId: asId<"AudioStreamId">("00112233-4455-6677-8899-aabbccddeeff"),
    sequence,
    timestampMs: sequence * 20,
    data,
  };
}
