import { once } from "node:events";
import {
  asId,
  decodeAudioWireFrame,
  encodeAudioWireFrame,
  newId,
} from "@voice-satellite/contracts";
import {
  ConnectorCoordinator,
  SingleRuntimeHost,
  WsRelayClient,
} from "@voice-satellite/connector";
import {
  RelayServer,
  connectorCredential,
  deviceCredential,
} from "@voice-satellite/relay";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { FakeAgentRuntime } from "../src/fakes/fake-agent-runtime.js";
import {
  FakeStreamingAsr,
  FakeStreamingTts,
} from "../src/fakes/fake-speech.js";
import { MemorySessionBindingStore } from "../src/fakes/memory-binding-store.js";

describe("network voice turn", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of cleanup.reverse()) await close();
    cleanup.length = 0;
  });

  it("runs device audio through relay and connector to a replaceable agent", async () => {
    const asr = new FakeStreamingAsr("现在几点？");
    const tts = new FakeStreamingTts();
    const relay = new RelayServer(asr, tts, {
      host: "127.0.0.1",
      port: 0,
      deviceCredentials: [deviceCredential("device-test", "device-secret")],
      connectorCredential: connectorCredential(
        "connector-test",
        "connector-secret",
      ),
    });
    const address = await relay.start();
    cleanup.push(() => relay.stop());

    const runtime = new FakeAgentRuntime({ response: "现在是测试时间。" });
    const coordinator = new ConnectorCoordinator(
      new SingleRuntimeHost(runtime),
      new MemorySessionBindingStore(),
    );
    const connector = new WsRelayClient(coordinator, {
      url: `ws://127.0.0.1:${address.port}/v1/connector`,
      token: "connector-secret",
      reconnectMinMs: 10,
      reconnectMaxMs: 20,
    });
    connector.start();
    cleanup.push(() => connector.stop());
    await waitUntil(async () => {
      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
      return ((await response.json()) as { connectorReady: boolean })
        .connectorReady;
    });

    const device = new WebSocket(`ws://127.0.0.1:${address.port}/v1/device`, {
      headers: { Authorization: "Bearer device-secret" },
    });
    cleanup.push(async () => device.close());
    await once(device, "open");
    device.send(
      JSON.stringify({
        v: 1,
        type: "device.hello",
        seq: 0,
        payload: { physicalApproval: true },
      }),
    );
    const welcome = await nextJson(device);
    expect(welcome.type).toBe("device.welcome");
    const connectionId = welcome.connectionId as string;
    const conversationId = welcome.conversationId as string;
    const turnId = newId<"TurnId">();
    const streamId = newId<"AudioStreamId">();
    const messages: unknown[] = [];
    const audio: Uint8Array[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      device.on("message", (data, isBinary) => {
        try {
          if (isBinary) {
            audio.push(decodeAudioWireFrame(data as Buffer).payload);
            return;
          }
          const message = JSON.parse(data.toString()) as { type: string };
          messages.push(message);
          if (message.type === "turn.done") resolve();
          if (message.type === "turn.error") reject(new Error(data.toString()));
        } catch (error) {
          reject(error);
        }
      });
    });
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

    await Promise.race([
      completed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("turn timed out")), 5_000),
      ),
    ]);
    expect(asr.framesReceived).toBe(1);
    expect(runtime.runCount).toBe(1);
    expect(tts.segments.join("")).toBe("现在是测试时间。");
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "transcript.final" }),
    );
    expect(audio.length).toBeGreaterThan(0);
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

async function waitUntil(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition timed out");
}
