import {
  type AgentEvent,
  type AgentRequest,
  type PermissionDecision,
  type PermissionRequestId,
  type RequestId,
  VoiceSatelliteError,
} from "@voice-satellite/contracts";
import type {
  AgentConversation,
  RuntimeEvent,
} from "../ports/agent-runtime.js";
import type { SessionBindingStore } from "../ports/session-binding-store.js";
import { RequestDedupeCache } from "./request-dedupe-cache.js";
import { SingleRuntimeHost } from "./single-runtime-host.js";

interface ActiveRequest {
  readonly requestId: RequestId;
  readonly conversation: AgentConversation;
}

export interface ConnectorCoordinatorOptions {
  readonly dedupeMaxEntries: number;
  readonly dedupeTtlMs: number;
}

const DEFAULT_OPTIONS: ConnectorCoordinatorOptions = {
  dedupeMaxEntries: 1_024,
  dedupeTtlMs: 10 * 60_000,
};

export class ConnectorCoordinator {
  readonly #dedupe: RequestDedupeCache;
  #active: ActiveRequest | undefined;

  public constructor(
    private readonly host: SingleRuntimeHost,
    private readonly bindings: SessionBindingStore,
    options: Partial<ConnectorCoordinatorOptions> = {},
  ) {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    this.#dedupe = new RequestDedupeCache({
      maxEntries: resolved.dedupeMaxEntries,
      ttlMs: resolved.dedupeTtlMs,
    });
  }

  public async ready(): Promise<boolean> {
    return (await this.host.health()).ready;
  }

  public async *run(
    request: AgentRequest,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    if (this.#active) {
      throw new VoiceSatelliteError(
        "busy",
        "connector already has an active request",
      );
    }
    if (this.#dedupe.has(request.requestId)) {
      throw new VoiceSatelliteError(
        "invalid_state",
        "duplicate request is not replayed",
      );
    }

    const stored = await this.bindings.load(request.conversationId);
    const conversation = await this.host.open(
      stored ?? { conversationId: request.conversationId },
    );
    this.#active = { requestId: request.requestId, conversation };
    await this.bindings.save({
      conversationId: request.conversationId,
      nativeSessionRef: conversation.nativeSessionRef,
    });

    let terminal = false;
    try {
      this.#dedupe.add(request.requestId);
      yield { type: "accepted" };
      for await (const event of conversation.run(request.text, signal)) {
        const projected = this.#project(event, request);
        yield projected;
        if (projected.type === "done" || projected.type === "error") {
          terminal = true;
          break;
        }
      }
      if (!terminal) {
        throw new VoiceSatelliteError(
          "invalid_message",
          "agent runtime ended without a terminal event",
        );
      }
    } finally {
      if (this.#active?.requestId === request.requestId) {
        this.#active = undefined;
      }
      await conversation.close();
    }
  }

  public async cancel(requestId: RequestId): Promise<void> {
    if (this.#active?.requestId !== requestId) {
      return;
    }
    await this.#active.conversation.cancel(requestId);
  }

  public async resolvePermission(
    requestId: PermissionRequestId,
    decision: PermissionDecision,
  ): Promise<void> {
    if (!this.#active) {
      throw new VoiceSatelliteError(
        "invalid_state",
        "no active permission request",
      );
    }
    await this.#active.conversation.resolvePermission(requestId, decision);
  }

  #project(event: RuntimeEvent, request: AgentRequest): AgentEvent {
    switch (event.type) {
      case "text_delta": {
        const delta = event.delta.slice(0, 16_384);
        if (delta.length === 0) {
          throw new VoiceSatelliteError(
            "invalid_message",
            "empty runtime text delta",
          );
        }
        return { type: "text_delta", delta };
      }
      case "status":
        return { type: "status", status: event.status.slice(0, 256) };
      case "permission_request":
        return {
          type: "permission_request",
          request: {
            requestId: event.request.requestId,
            turnId: request.turnId,
            summary: event.request.summary.slice(0, 512),
          },
        };
      case "done":
        return event;
      case "error":
        return {
          type: "error",
          code: event.code,
          message: event.message.slice(0, 512),
        };
    }
  }
}
