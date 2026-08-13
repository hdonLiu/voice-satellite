import {
  RelayToConnectorSchema,
  type RelayToConnectorMessage,
  type AgentRequest,
  type ConnectionId,
  type PermissionDecision,
  asId,
  parseJsonSchema,
  toStableError,
} from "@voice-satellite/contracts";
import WebSocket from "ws";
import type { ConnectorCoordinator } from "../application/connector-coordinator.js";

export interface WsRelayClientOptions {
  readonly url: string;
  readonly token: string;
  readonly softwareVersion?: string;
  readonly reconnectMinMs?: number;
  readonly reconnectMaxMs?: number;
}

export class WsRelayClient {
  #socket: WebSocket | undefined;
  #stopped = true;
  #loop: Promise<void> | undefined;
  #activeAbort: AbortController | undefined;

  public constructor(
    private readonly coordinator: ConnectorCoordinator,
    private readonly options: WsRelayClientOptions,
  ) {}

  public start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#loop = this.#reconnectLoop();
  }

  public async stop(): Promise<void> {
    this.#stopped = true;
    this.#activeAbort?.abort(
      new DOMException("connector stopping", "AbortError"),
    );
    this.#socket?.close(1000, "connector stopping");
    await this.#loop;
  }

  async #reconnectLoop(): Promise<void> {
    let delay = this.options.reconnectMinMs ?? 1_000;
    const maxDelay = this.options.reconnectMaxMs ?? 30_000;
    while (!this.#stopped) {
      try {
        await this.#connectOnce();
        delay = this.options.reconnectMinMs ?? 1_000;
      } catch (error) {
        if (!this.#stopped)
          console.error(
            "relay connection failed:",
            error instanceof Error ? error.message : error,
          );
      }
      if (this.#stopped) break;
      await new Promise((resolve) =>
        setTimeout(resolve, delay + Math.floor(Math.random() * delay * 0.2)),
      );
      delay = Math.min(maxDelay, delay * 2);
    }
  }

  async #connectOnce(): Promise<void> {
    const socket = new WebSocket(this.options.url, {
      headers: { Authorization: `Bearer ${this.options.token}` },
      perMessageDeflate: false,
      handshakeTimeout: 10_000,
      maxPayload: 128 * 1024,
    });
    this.#socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    let connectionId: ConnectionId | undefined;
    let outgoingSeq = 0;
    let incomingSeq = 0;
    let chain = Promise.resolve();
    const send = async (message: object): Promise<void> => {
      await sendJson(socket, message);
    };
    await send({
      v: 1,
      type: "connector.hello",
      seq: outgoingSeq++,
      payload: {
        softwareVersion: this.options.softwareVersion ?? "0.1.0",
        agent: "openclaw",
      },
    });
    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        socket.close(4002, "unexpected binary connector message");
        return;
      }
      chain = chain
        .then(async () => {
          const message = parseJsonSchema(
            RelayToConnectorSchema,
            data.toString(),
          );
          if (message.seq !== incomingSeq++)
            throw new Error("relay control sequence mismatch");
          if (message.type === "connector.welcome") {
            if (connectionId) throw new Error("duplicate connector welcome");
            connectionId = asId<"ConnectionId">(message.connectionId);
            const ready = await this.coordinator.ready();
            if (!ready) throw new Error("OpenClaw runtime is not ready");
            await send({
              v: 1,
              type: "connector.ready",
              connectionId,
              seq: outgoingSeq++,
              payload: {},
            });
            return;
          }
          if (!connectionId || message.connectionId !== connectionId)
            throw new Error("connector connection id mismatch");
          switch (message.type) {
            case "ping":
              await send({
                v: 1,
                type: "pong",
                connectionId,
                seq: outgoingSeq++,
                payload: { timestampMs: message.payload.timestampMs },
              });
              break;
            case "agent.run":
              if (this.#activeAbort)
                throw new Error(
                  "received agent.run while another request is active",
                );
              this.#activeAbort = new AbortController();
              void this.#run(
                message,
                connectionId,
                () => outgoingSeq++,
                send,
              ).finally(() => {
                this.#activeAbort = undefined;
              });
              break;
            case "agent.cancel":
              this.#activeAbort?.abort(
                new DOMException("relay cancelled request", "AbortError"),
              );
              await this.coordinator.cancel(
                asId<"RequestId">(message.requestId),
              );
              break;
            case "agent.permission_resolve":
              await this.coordinator.resolvePermission(
                asId<"PermissionRequestId">(
                  message.payload.permissionRequestId,
                ),
                message.payload.decision,
              );
              break;
          }
        })
        .catch(() => socket.close(4002, "invalid relay message"));
    });
    await closed;
    this.#activeAbort?.abort(
      new DOMException("relay disconnected", "AbortError"),
    );
    this.#activeAbort = undefined;
    this.#socket = undefined;
    await chain.catch(() => undefined);
  }

  async #run(
    message: Extract<RelayToConnectorMessage, { type: "agent.run" }>,
    connectionId: ConnectionId,
    nextSequence: () => number,
    send: (message: object) => Promise<void>,
  ): Promise<void> {
    const request: AgentRequest = {
      deviceId: asId<"DeviceId">(message.deviceId),
      conversationId: asId<"ConversationId">(message.conversationId),
      turnId: asId<"TurnId">(message.turnId),
      requestId: asId<"RequestId">(message.requestId),
      text: message.payload.text,
      deadlineMs: message.payload.deadlineMs,
    };
    const base = {
      v: 1,
      connectionId,
      deviceId: request.deviceId,
      conversationId: request.conversationId,
      turnId: request.turnId,
      requestId: request.requestId,
    } as const;
    try {
      for await (const event of this.coordinator.run(
        request,
        this.#activeAbort!.signal,
      )) {
        switch (event.type) {
          case "accepted":
            await send({
              ...base,
              type: "agent.accepted",
              seq: nextSequence(),
              payload: {},
            });
            break;
          case "text_delta":
            await send({
              ...base,
              type: "agent.text_delta",
              seq: nextSequence(),
              payload: { delta: event.delta },
            });
            break;
          case "status":
            await send({
              ...base,
              type: "agent.status",
              seq: nextSequence(),
              payload: { status: event.status },
            });
            break;
          case "permission_request":
            await send({
              ...base,
              type: "agent.permission_request",
              seq: nextSequence(),
              payload: {
                permissionRequestId: event.request.requestId,
                summary: event.request.summary,
              },
            });
            break;
          case "done":
            await send({
              ...base,
              type: "agent.done",
              seq: nextSequence(),
              payload: {},
            });
            break;
          case "error":
            await send({
              ...base,
              type: "agent.error",
              seq: nextSequence(),
              payload: { code: event.code, message: event.message },
            });
            break;
        }
      }
    } catch (error) {
      const aborted = this.#activeAbort?.signal.aborted;
      const stable = toStableError(error);
      await send({
        ...base,
        type: "agent.error",
        seq: nextSequence(),
        payload: {
          code: aborted ? "cancelled" : stable.code,
          message: aborted ? "agent request cancelled" : stable.message,
        },
      }).catch(() => undefined);
    }
  }
}

function sendJson(socket: WebSocket, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error("WebSocket is closed"));
      return;
    }
    socket.send(JSON.stringify(value), (error) =>
      error ? reject(error) : resolve(),
    );
  });
}
