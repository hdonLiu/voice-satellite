import { once } from "node:events";
import { encodeAudioWireFrame, newId } from "@voice-satellite/contracts";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { relayConfigFromEnv } from "../src/config.js";
import { RelayServer, deviceCredential } from "../src/server/relay-server.js";

describe("device-link Relay mode", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requires only a device credential", () => {
    const config = relayConfigFromEnv({
      VS_RELAY_MODE: "device-link",
      VS_RELAY_DEVICE_TOKENS: JSON.stringify({ "device-test": "secret" }),
    });

    expect(config.mode).toBe("device-link");
    expect(config.server.connectorCredential).toBeUndefined();
  });

  it("accepts bounded device audio without speech or Agent providers", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const relay = new RelayServer(undefined, undefined, {
      host: "127.0.0.1",
      port: 0,
      mode: "device-link",
      deviceCredentials: [deviceCredential("device-test", "device-secret")],
    });
    const address = await relay.start();
    const device = new WebSocket(`ws://127.0.0.1:${address.port}/v1/device`, {
      headers: { Authorization: "Bearer device-secret" },
    });
    const opened = once(device, "open");

    try {
      const health = await fetch(
        `http://127.0.0.1:${address.port}/healthz`,
      ).then((response) => response.json());
      expect(health).toEqual({
        ok: true,
        mode: "device-link",
        connectorReady: false,
      });

      await opened;
      device.send(
        JSON.stringify({
          v: 1,
          type: "device.hello",
          seq: 0,
          payload: { physicalApproval: false },
        }),
      );
      const welcome = await nextJson(device);
      expect(welcome.payload).toEqual({ connectorOnline: false });

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
      for (let sequence = 0; sequence < 2; sequence += 1) {
        device.send(
          encodeAudioWireFrame({
            direction: "input",
            sequence,
            timestampMs: sequence * 20,
            streamId,
            payload: new Uint8Array(640),
          }),
        );
      }
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
      expect(messages.map((message) => message.type)).toContain("turn.done");
      expect(info).toHaveBeenCalledWith(
        JSON.stringify({
          event: "device_link_audio_received",
          frames: 2,
          bytes: 1_280,
          durationMs: 40,
        }),
      );
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
): Promise<Array<{ type: string }>> {
  return await new Promise((resolve, reject) => {
    const messages: Array<{ type: string }> = [];
    const timer = setTimeout(() => reject(new Error("turn timed out")), 5_000);
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (isBinary) return;
      try {
        const message = JSON.parse(data.toString()) as { type: string };
        messages.push(message);
        if (message.type === "turn.error") {
          clearTimeout(timer);
          socket.off("message", onMessage);
          reject(new Error(data.toString()));
        }
        if (message.type === "turn.done") {
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
