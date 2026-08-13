import { type AudioFrame, newId } from "@voice-satellite/contracts";

export async function* fakeAudioFrames(count = 3): AsyncIterable<AudioFrame> {
  const streamId = newId<"AudioStreamId">();
  for (let sequence = 0; sequence < count; sequence++) {
    yield {
      streamId,
      sequence,
      timestampMs: sequence * 20,
      data: new Uint8Array(640),
    };
  }
}
