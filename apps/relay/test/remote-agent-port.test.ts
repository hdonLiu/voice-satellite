import {
  VoiceSatelliteError,
  asId,
  type AgentRequest,
  type ConnectionId,
} from "@voice-satellite/contracts";
import { describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { RemoteAgentPort } from "../src/adapters/connector-ws/remote-agent-port.js";

class FakeSocket {
  public readonly OPEN = 1;
  public readyState = this.OPEN;
  public readonly sent: string[] = [];
  public closeCode: number | undefined;

  public send(
    data: string | Uint8Array,
    _options: object,
    callback: (error?: Error) => void,
  ): void {
    this.sent.push(String(data));
    callback();
  }

  public close(code: number): void {
    this.closeCode = code;
    this.readyState = 3;
  }
}

describe("RemoteAgentPort", () => {
  it("fails an accepted request as execution_unknown when replaced", async () => {
    const port = new RemoteAgentPort();
    const first = new FakeSocket();
    const connectionId = id<"ConnectionId">("connection-1");
    makeReady(port, first, connectionId);

    const request = makeRequest("request-1");
    const iterator = port
      .run(request, new AbortController().signal)
      [Symbol.asyncIterator]();
    const accepted = iterator.next();
    await nextTask();
    await port.receive(
      JSON.stringify({
        v: 1,
        type: "agent.accepted",
        connectionId,
        seq: 2,
        deviceId: request.deviceId,
        conversationId: request.conversationId,
        turnId: request.turnId,
        requestId: request.requestId,
        payload: {},
      }),
    );
    await expect(accepted).resolves.toEqual({
      done: false,
      value: { type: "accepted" },
    });

    const second = new FakeSocket();
    port.attach(second as unknown as WebSocket, id("connection-2"));

    await expect(iterator.next()).rejects.toMatchObject({
      code: "execution_unknown",
    });
    expect(first.closeCode).toBe(4009);
  });

  it("rejects concurrent requests without disconnecting the Connector", async () => {
    const port = new RemoteAgentPort();
    const socket = new FakeSocket();
    makeReady(port, socket, id("connection-1"));

    const first = port
      .run(makeRequest("request-1"), new AbortController().signal)
      [Symbol.asyncIterator]();
    const firstResult = first.next();
    await nextTask();
    const second = port
      .run(makeRequest("request-2"), new AbortController().signal)
      [Symbol.asyncIterator]();

    await expect(second.next()).rejects.toMatchObject({ code: "busy" });
    expect(socket.closeCode).toBeUndefined();

    port.detach(socket as unknown as WebSocket);
    await expect(firstResult).rejects.toBeInstanceOf(VoiceSatelliteError);
  });
});

function makeReady(
  port: RemoteAgentPort,
  socket: FakeSocket,
  connectionId: ConnectionId,
): void {
  port.attach(socket as unknown as WebSocket, connectionId);
  port.markHello(0);
  void port.receive(
    JSON.stringify({
      v: 1,
      type: "connector.ready",
      connectionId,
      seq: 1,
      payload: {},
    }),
  );
}

function makeRequest(requestId: string): AgentRequest {
  return {
    deviceId: id("device-1"),
    conversationId: id("conversation-1"),
    turnId: id(`turn-${requestId}`),
    requestId: id(requestId),
    text: "hello",
    deadlineMs: 10_000,
  };
}

function id<Name extends string>(value: string) {
  return asId<Name>(value);
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
