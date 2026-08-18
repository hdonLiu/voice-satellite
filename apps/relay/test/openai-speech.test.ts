import { asId } from "@voice-satellite/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  OpenAiPcmTts,
  OpenAiTranscriptionAsr,
  WhisperCppAsr,
  pcmS16leToWav,
} from "../src/index.js";

const context = {
  deviceId: asId<"DeviceId">("device-1"),
  conversationId: asId<"ConversationId">("conversation-1"),
  turnId: asId<"TurnId">("turn-1"),
};

describe("OpenAI speech adapters", () => {
  it("builds a standards-compliant PCM WAV envelope", () => {
    const wav = pcmS16leToWav(Uint8Array.of(1, 2, 3, 4), 16_000, 1);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(4);
  });

  it("uploads bounded capture and emits one final transcript", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ text: "  测试转写  " }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const asr = new OpenAiTranscriptionAsr({ apiKey: "test", fetch });
    const stream = await asr.open(context, new AbortController().signal);
    await stream.push({
      streamId: asId<"AudioStreamId">("00112233-4455-6677-8899-aabbccddeeff"),
      sequence: 0,
      timestampMs: 0,
      data: new Uint8Array(640),
    });
    await stream.finish();
    const events = [];
    for await (const event of stream.events) events.push(event);
    expect(events).toEqual([{ type: "final", text: "测试转写" }]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/audio/transcriptions",
    );
  });

  it("posts a compatible WAV to a private whisper.cpp server", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ text: " 本地识别 " }), { status: 200 }),
      );
    const asr = new WhisperCppAsr({
      baseUrl: "http://whisper.internal:8080/",
      language: "zh",
      fetch,
    });
    const stream = await asr.open(context, new AbortController().signal);
    await stream.push({
      streamId: asId<"AudioStreamId">("00112233-4455-6677-8899-aabbccddeeff"),
      sequence: 0,
      timestampMs: 0,
      data: new Uint8Array(640),
    });
    await stream.finish();
    const events = [];
    for await (const event of stream.events) events.push(event);
    expect(events).toEqual([{ type: "final", text: "本地识别" }]);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://whisper.internal:8080/inference",
    );
    const form = fetch.mock.calls[0]?.[1]?.body;
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("language")).toBe("zh");
    expect((form as FormData).get("response_format")).toBe("json");
  });

  it("frames streamed 24 kHz PCM and pads only the final frame", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(1_000).fill(7));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );
    const tts = new OpenAiPcmTts({ apiKey: "test", fetch });
    const stream = await tts.open(context, new AbortController().signal);
    const framesPromise = (async () => {
      const frames = [];
      for await (const frame of stream.audio) frames.push(frame);
      return frames;
    })();
    await stream.append("你好");
    await stream.finish();
    const frames = await framesPromise;
    expect(frames).toHaveLength(2);
    expect(frames[0]?.data).toHaveLength(960);
    expect(frames[1]?.data).toHaveLength(960);
    expect(frames[1]?.data[39]).toBe(7);
    expect(frames[1]?.data[40]).toBe(0);
  });
});
