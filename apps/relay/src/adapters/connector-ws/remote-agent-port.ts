import {
  ConnectorToRelaySchema,
  type AgentEvent,
  type AgentRequest,
  type ConnectionId,
  type ConnectorToRelayMessage,
  type PermissionDecision,
  type PermissionRequestId,
  type RequestId,
  VoiceSatelliteError,
  asId,
  parseJsonSchema,
} from "@voice-satellite/contracts";
import type WebSocket from "ws";
import { BoundedAsyncQueue } from "../../application/bounded-async-queue.js";
import type { AgentPort } from "../../ports/agent.js";
import {
  IncomingSequence,
  OutgoingSequence,
  rawDataToText,
  sendJson,
} from "../../infrastructure/link-utils.js";

interface PendingRequest {
  readonly request: AgentRequest;
  readonly events: BoundedAsyncQueue<AgentEvent>;
  accepted: boolean;
}

export class RemoteAgentPort implements AgentPort {
  #socket: WebSocket | undefined;
  #connectionId: ConnectionId | undefined;
  #ready = false;
  #incoming = new IncomingSequence();
  #outgoing = new OutgoingSequence();
  readonly #pending = new Map<RequestId, PendingRequest>();
  readonly #permissions = new Map<PermissionRequestId, RequestId>();

  public get ready(): boolean {
    return this.#ready && this.#socket?.readyState === 1;
  }

  public attach(socket: WebSocket, connectionId: ConnectionId): void {
    if (this.#socket && this.#socket.readyState === this.#socket.OPEN) {
      this.#socket.close(4009, "replaced by a new connector");
    }
    this.#socket = socket;
    this.#connectionId = connectionId;
    this.#ready = false;
    this.#incoming = new IncomingSequence();
    this.#outgoing = new OutgoingSequence();
  }

  public markHello(sequence: number): void {
    this.#incoming.accept(sequence);
  }

  public nextSequence(): number {
    return this.#outgoing.take();
  }

  public async receive(raw: string): Promise<void> {
    const message = parseJsonSchema(ConnectorToRelaySchema, raw);
    if (message.type === "connector.hello") {
      throw new VoiceSatelliteError(
        "invalid_message",
        "duplicate connector hello",
      );
    }
    this.#assertConnection(message.connectionId);
    this.#incoming.accept(message.seq);
    switch (message.type) {
      case "connector.ready":
        this.#ready = true;
        return;
      case "pong":
        return;
      default:
        this.#dispatchAgentEvent(message);
    }
  }

  public detach(socket: WebSocket): void {
    if (this.#socket !== socket) return;
    this.#socket = undefined;
    this.#connectionId = undefined;
    this.#ready = false;
    for (const pending of this.#pending.values()) {
      pending.events.fail(
        new VoiceSatelliteError(
          pending.accepted ? "execution_unknown" : "connector_offline",
          pending.accepted
            ? "connector disconnected after accepting the request"
            : "connector disconnected before accepting the request",
        ),
      );
    }
    this.#pending.clear();
    this.#permissions.clear();
  }

  public async *run(
    request: AgentRequest,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    const socket = this.#requireReadySocket();
    if (this.#pending.has(request.requestId)) {
      throw new VoiceSatelliteError(
        "invalid_state",
        "duplicate agent request id",
      );
    }
    const events = new BoundedAsyncQueue<AgentEvent>(256);
    const pending: PendingRequest = { request, events, accepted: false };
    this.#pending.set(request.requestId, pending);
    const onAbort = (): void =>
      void this.cancel(request.requestId).catch(() => undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await sendJson(socket, {
        v: 1,
        type: "agent.run",
        connectionId: this.#connectionId,
        seq: this.#outgoing.take(),
        deviceId: request.deviceId,
        conversationId: request.conversationId,
        turnId: request.turnId,
        requestId: request.requestId,
        payload: { text: request.text, deadlineMs: request.deadlineMs },
      });
      for await (const event of events) yield event;
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.#pending.delete(request.requestId);
      for (const [permissionId, owner] of this.#permissions) {
        if (owner === request.requestId) this.#permissions.delete(permissionId);
      }
    }
  }

  public async cancel(requestId: RequestId): Promise<void> {
    const pending = this.#pending.get(requestId);
    if (!pending || !this.#socket || !this.#connectionId) return;
    await sendJson(this.#socket, {
      v: 1,
      type: "agent.cancel",
      connectionId: this.#connectionId,
      seq: this.#outgoing.take(),
      deviceId: pending.request.deviceId,
      conversationId: pending.request.conversationId,
      turnId: pending.request.turnId,
      requestId,
      payload: {},
    });
  }

  public async resolvePermission(
    requestId: PermissionRequestId,
    decision: PermissionDecision,
  ): Promise<void> {
    const owner = this.#permissions.get(requestId);
    const pending = owner ? this.#pending.get(owner) : undefined;
    if (!owner || !pending || !this.#socket || !this.#connectionId) {
      throw new VoiceSatelliteError(
        "invalid_state",
        "permission request is no longer active",
      );
    }
    this.#permissions.delete(requestId);
    await sendJson(this.#socket, {
      v: 1,
      type: "agent.permission_resolve",
      connectionId: this.#connectionId,
      seq: this.#outgoing.take(),
      deviceId: pending.request.deviceId,
      conversationId: pending.request.conversationId,
      turnId: pending.request.turnId,
      requestId: owner,
      payload: { permissionRequestId: requestId, decision },
    });
  }

  #dispatchAgentEvent(
    message: Exclude<
      ConnectorToRelayMessage,
      { type: "connector.hello" | "connector.ready" | "pong" }
    >,
  ): void {
    if (!("requestId" in message)) return;
    const requestId = asId<"RequestId">(message.requestId);
    const pending = this.#pending.get(requestId);
    if (!pending)
      throw new VoiceSatelliteError(
        "invalid_state",
        "event references an inactive request",
      );
    if (
      message.conversationId !== pending.request.conversationId ||
      message.turnId !== pending.request.turnId
    ) {
      throw new VoiceSatelliteError(
        "invalid_message",
        "agent event routing fields do not match the request",
      );
    }
    if (pending.events.size >= pending.events.capacity) {
      const error = new VoiceSatelliteError(
        "backpressure",
        "connector event queue is full",
      );
      pending.events.fail(error);
      throw error;
    }
    switch (message.type) {
      case "agent.accepted":
        if (pending.accepted)
          throw new VoiceSatelliteError(
            "invalid_message",
            "duplicate agent acceptance",
          );
        pending.accepted = true;
        void pending.events.push({ type: "accepted" });
        break;
      case "agent.text_delta":
        void pending.events.push({
          type: "text_delta",
          delta: message.payload.delta,
        });
        break;
      case "agent.status":
        void pending.events.push({
          type: "status",
          status: message.payload.status,
        });
        break;
      case "agent.permission_request": {
        const permissionId = asId<"PermissionRequestId">(
          message.payload.permissionRequestId,
        );
        this.#permissions.set(permissionId, requestId);
        void pending.events.push({
          type: "permission_request",
          request: {
            requestId: permissionId,
            turnId: pending.request.turnId,
            summary: message.payload.summary,
          },
        });
        break;
      }
      case "agent.done":
        void pending.events
          .push({ type: "done" })
          .then(() => pending.events.close());
        break;
      case "agent.error":
        void pending.events
          .push({
            type: "error",
            code: message.payload.code,
            message: message.payload.message,
          })
          .then(() => pending.events.close());
        break;
    }
  }

  #assertConnection(value: string): void {
    if (!this.#connectionId || value !== this.#connectionId) {
      throw new VoiceSatelliteError(
        "invalid_message",
        "connector connection id mismatch",
      );
    }
  }

  #requireReadySocket(): WebSocket {
    if (!this.ready || !this.#socket)
      throw new VoiceSatelliteError(
        "connector_offline",
        "connector is offline",
      );
    return this.#socket;
  }
}

export function bindRemoteAgentSocket(
  port: RemoteAgentPort,
  socket: WebSocket,
): void {
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      socket.close(4002, "binary connector messages are not supported");
      return;
    }
    void port
      .receive(rawDataToText(data))
      .catch(() => socket.close(4002, "invalid connector message"));
  });
  socket.once("close", () => port.detach(socket));
  socket.once("error", () => port.detach(socket));
}
