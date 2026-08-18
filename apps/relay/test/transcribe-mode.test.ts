import { once } from "node:events";
import {
  type AsrEvent,
  type AudioFrame,
  encodeAudioWireFrame,
  newId,
} from "@voice-satellite/contracts";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { BoundedAsyncQueue } from "../src/application/bounded-async-queue.js";
import { relayConfigFromEnv } from "../src/config.js";
import type {
  AsrContext,
  AsrStream,
  StreamingAsrPort,
} from "../src/ports/speech.js";
import type {
  RecognizedTranscript,
  TranscriptSinkPort,
} from "../src/ports/transcript-sink.js";
import { RelayServer, deviceCredential } from "../src/server/relay-server.js";

class FinalAsr implements StreamingAsrPort {
  public frames = 0;

  public async open(
    _context: AsrContext,
    signal: AbortSignal,
  ): Promise<AsrStream> {
    const events = new BoundedAsyncQueue<AsrEvent>(2);
    return {
      events,
      push: async (_frame: AudioFrame) => {
        signal.throwIfAborted();
        this.frames += 1;
      },
      finish: async () => {
        await events.push({ type: "final", text: "你好，语音卫星" });
        events.close();
      },
      cancel: async () => events.close(),
    };
  }
}

class RecordingSink implements TranscriptSinkPort {
  public readonly transcripts: RecognizedTranscript[] = [];

  public async publish(
    transcript: RecognizedTranscript,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    this.transcripts.push(transcript);
  }
}

describe("transcribe Relay mode", () => {
  it("requires ASR but not Connector or TTS configuration", () => {
    const config = relayConfigFromEnv({
      VS_RELAY_MODE: "transcribe",
      VS_ASR_PROVIDER: "whisper-cpp",
      VS_RELAY_DEVICE_TOKENS: JSON.stringify({ "device-test": "secret" }),
      OPENAI_TRANSCRIBE_LANGUAGE: "zh",
    });

    expect(config.mode).toBe("transcribe");
    if (config.mode !== "transcribe") throw new Error("unexpected mode");
    expect(config.asr).toEqual({
      provider: "whisper-cpp",
      config: { language: "zh" },
    });
    expect(config.server.connectorCredential).toBeUndefined();
  });

  it("returns transcript.final and forwards the same semantic text", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const asr = new FinalAsr();
    const sink = new RecordingSink();
    const relay = new RelayServer(
      asr,
      undefined,
      {
        host: "127.0.0.1",
        port: 0,
        mode: "transcribe",
        deviceCredentials: [deviceCredential("device-test", "device-secret")],
      },
      sink,
    );
    const address = await relay.start();
    const device = new WebSocket(`ws://127.0.0.1:${address.port}/v1/device`, {
      headers: { Authorization: "Bearer device-secret" },
    });

    try {
      await once(device, "open");
      device.send(
        JSON.stringify({
          v: 1,
          type: "device.hello",
          seq: 0,
          payload: { physicalApproval: false },
        }),
      );
      const welcome = await nextJson(device);
      const connectionId = welcome.connectionId as string;
      const conversationId = welcome.conversationId as string;
      const turnId = newId<"TurnId">();
      const streamId = newId<"AudioStreamId">();
      const completed = collectUntilDone(device);

      device.send(
        JSON.stringify({
          v: 1,
          type: "turn.start",
          connectionId,
          seq: 1,
          conversationId,
          turnId,
          payload: { audioStreamId: streamId },
        }),
      );
      device.send(
        encodeAudioWireFrame({
          direction: "input",
          sequence: 0,
          timestampMs: 0,
          streamId,
          payload: new Uint8Array(640),
        }),
      );
      device.send(
        JSON.stringify({
          v: 1,
          type: "turn.input_end",
          connectionId,
          seq: 2,
          conversationId,
          turnId,
          payload: {},
        }),
      );

      const messages = await completed;
      expect(asr.frames).toBe(1);
      expect(
        messages.find((message) => message.type === "transcript.final")
          ?.payload,
      ).toEqual({ text: "你好，语音卫星" });
      expect(sink.transcripts).toHaveLength(1);
      expect(sink.transcripts[0]?.text).toBe("你好，语音卫星");
    } finally {
      device.close();
      await relay.stop();
    }
  });

  it("server-endpoints speech without a device input_end message", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const asr = new FinalAsr();
    const sink = new RecordingSink();
    const relay = new RelayServer(
      asr,
      undefined,
      {
        host: "127.0.0.1",
        port: 0,
        mode: "transcribe",
        deviceCredentials: [deviceCredential("device-test", "device-secret")],
        serverEndpointer: {
          rmsThreshold: 500,
          minimumSpeechMs: 40,
          trailingSilenceMs: 40,
          noSpeechTimeoutMs: 200,
          maximumCaptureMs: 1_000,
        },
      },
      sink,
    );
    const address = await relay.start();
    const device = new WebSocket(`ws://127.0.0.1:${address.port}/v1/device`, {
      headers: { Authorization: "Bearer device-secret" },
    });

    try {
      await once(device, "open");
      device.send(
        JSON.stringify({
          v: 1,
          type: "device.hello",
          seq: 0,
          payload: { physicalApproval: false },
        }),
      );
      const welcome = await nextJson(device);
      const connectionId = welcome.connectionId as string;
      const conversationId = welcome.conversationId as string;
      const turnId = newId<"TurnId">();
      const streamId = newId<"AudioStreamId">();
      const completed = collectUntilDone(device);

      device.send(
        JSON.stringify({
          v: 1,
          type: "turn.start",
          connectionId,
          seq: 1,
          conversationId,
          turnId,
          payload: { audioStreamId: streamId, endpointing: "server" },
        }),
      );
      for (const [sequence, amplitude] of [1_000, 1_000, 0, 0].entries()) {
        device.send(
          encodeAudioWireFrame({
            direction: "input",
            sequence,
            timestampMs: sequence * 20,
            streamId,
            payload: pcmFrame(amplitude),
          }),
        );
      }

      const messages = await completed;
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "turn.input_stop",
          payload: { reason: "speech_end" },
        }),
      );
      expect(asr.frames).toBe(4);
      expect(sink.transcripts).toHaveLength(1);
    } finally {
      device.close();
      await relay.stop();
    }
  });

  it("commits detected speech at the server maximum capture deadline", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const asr = new FinalAsr();
    const relay = new RelayServer(
      asr,
      undefined,
      {
        host: "127.0.0.1",
        port: 0,
        mode: "transcribe",
        deviceCredentials: [deviceCredential("device-test", "device-secret")],
        serverEndpointer: {
          rmsThreshold: 500,
          minimumSpeechMs: 20,
          trailingSilenceMs: 200,
          noSpeechTimeoutMs: 50,
          maximumCaptureMs: 80,
        },
      },
      new RecordingSink(),
    );
    const address = await relay.start();
    const device = new WebSocket(`ws://127.0.0.1:${address.port}/v1/device`, {
      headers: { Authorization: "Bearer device-secret" },
    });

    try {
      await once(device, "open");
      device.send(
        JSON.stringify({
          v: 1,
          type: "device.hello",
          seq: 0,
          payload: { physicalApproval: false },
        }),
      );
      const welcome = await nextJson(device);
      const turnId = newId<"TurnId">();
      const streamId = newId<"AudioStreamId">();
      const completed = collectUntilDone(device);
      device.send(
        JSON.stringify({
          v: 1,
          type: "turn.start",
          connectionId: welcome.connectionId,
          seq: 1,
          conversationId: welcome.conversationId,
          turnId,
          payload: { audioStreamId: streamId, endpointing: "server" },
        }),
      );
      device.send(
        encodeAudioWireFrame({
          direction: "input",
          sequence: 0,
          timestampMs: 0,
          streamId,
          payload: pcmFrame(1_000),
        }),
      );

      const messages = await completed;
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "turn.input_stop",
          payload: { reason: "max_duration" },
        }),
      );
      expect(asr.frames).toBe(1);
    } finally {
      device.close();
      await relay.stop();
    }
  });

  it("cancels a server-endpointed turn when speech never becomes sustained", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const asr = new FinalAsr();
    const relay = new RelayServer(
      asr,
      undefined,
      {
        host: "127.0.0.1",
        port: 0,
        mode: "transcribe",
        deviceCredentials: [deviceCredential("device-test", "device-secret")],
        serverEndpointer: {
          noSpeechTimeoutMs: 100,
          maximumCaptureMs: 300,
        },
      },
      new RecordingSink(),
    );
    const address = await relay.start();
    const device = new WebSocket(`ws://127.0.0.1:${address.port}/v1/device`, {
      headers: { Authorization: "Bearer device-secret" },
    });

    try {
      await once(device, "open");
      device.send(
        JSON.stringify({
          v: 1,
          type: "device.hello",
          seq: 0,
          payload: { physicalApproval: false },
        }),
      );
      const welcome = await nextJson(device);
      const terminal = collectUntilTerminal(device);
      const turnId = newId<"TurnId">();
      const streamId = newId<"AudioStreamId">();
      device.send(
        JSON.stringify({
          v: 1,
          type: "turn.start",
          connectionId: welcome.connectionId,
          seq: 1,
          conversationId: welcome.conversationId,
          turnId,
          payload: {
            audioStreamId: streamId,
            endpointing: "server",
          },
        }),
      );
      device.send(
        encodeAudioWireFrame({
          direction: "input",
          sequence: 0,
          timestampMs: 0,
          streamId,
          payload: pcmFrame(1_000),
        }),
      );

      const messages = await terminal;
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "turn.input_stop",
          payload: { reason: "no_speech" },
        }),
      );
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "turn.error",
          payload: expect.objectContaining({ code: "cancelled" }),
        }),
      );
      expect(asr.frames).toBe(1);
    } finally {
      device.close();
      await relay.stop();
    }
  });
});

async function nextJson(socket: WebSocket): Promise<Record<string, unknown>> {
  const [data, isBinary] = (await once(socket, "message")) as [
    WebSocket.RawData,
    boolean,
  ];
  if (isBinary) throw new Error("expected a text message");
  return JSON.parse(data.toString()) as Record<string, unknown>;
}

async function collectUntilDone(
  socket: WebSocket,
): Promise<Array<{ type: string; payload?: unknown }>> {
  return await new Promise((resolve, reject) => {
    const messages: Array<{ type: string; payload?: unknown }> = [];
    const timer = setTimeout(() => reject(new Error("turn timed out")), 5_000);
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (isBinary) return;
      try {
        const message = JSON.parse(data.toString()) as {
          type: string;
          payload?: unknown;
        };
        messages.push(message);
        if (message.type === "turn.error") {
          clearTimeout(timer);
          socket.off("message", onMessage);
          reject(new Error(data.toString()));
        } else if (message.type === "turn.done") {
          clearTimeout(timer);
          socket.off("message", onMessage);
          resolve(messages);
        }
      } catch (error) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        reject(error);
      }
    };
    socket.on("message", onMessage);
  });
}

function pcmFrame(amplitude: number): Uint8Array {
  const data = new Uint8Array(640);
  const view = new DataView(data.buffer);
  for (let offset = 0; offset < data.byteLength; offset += 2) {
    view.setInt16(offset, amplitude, true);
  }
  return data;
}

async function collectUntilTerminal(
  socket: WebSocket,
): Promise<Array<{ type: string; payload?: unknown }>> {
  return await new Promise((resolve, reject) => {
    const messages: Array<{ type: string; payload?: unknown }> = [];
    const timer = setTimeout(() => reject(new Error("turn timed out")), 5_000);
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (isBinary) return;
      const message = JSON.parse(data.toString()) as {
        type: string;
        payload?: unknown;
      };
      messages.push(message);
      if (message.type === "turn.done" || message.type === "turn.error") {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(messages);
      }
    };
    socket.on("message", onMessage);
  });
}
