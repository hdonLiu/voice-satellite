import type {
  PermissionDecision,
  PermissionRequestId,
  RequestId,
} from "@voice-satellite/contracts";
import { newId } from "@voice-satellite/contracts";
import { setTimeout as delay } from "node:timers/promises";
import {
  type AgentConversation,
  type AgentRuntimePort,
  type RuntimeEvent,
  type SessionBinding,
} from "@voice-satellite/connector";

export interface FakeAgentRuntimeOptions {
  readonly response: string;
  readonly deltaCharacters?: number;
  readonly deltaDelayMs?: number;
  readonly permissionSummary?: string;
}

export class FakeAgentRuntime implements AgentRuntimePort {
  public openCount = 0;
  public runCount = 0;
  public cancelCount = 0;
  public closeCount = 0;
  public readonly permissionDecisions: PermissionDecision[] = [];
  readonly #options: {
    readonly response: string;
    readonly deltaCharacters: number;
    readonly deltaDelayMs: number;
    readonly permissionSummary?: string;
  };

  public constructor(options: FakeAgentRuntimeOptions) {
    this.#options = {
      response: options.response,
      deltaCharacters: options.deltaCharacters ?? 3,
      deltaDelayMs: options.deltaDelayMs ?? 0,
      ...(options.permissionSummary === undefined
        ? {}
        : { permissionSummary: options.permissionSummary }),
    };
  }

  public async health(): Promise<{ readonly ready: true }> {
    return { ready: true };
  }

  public async open(binding: SessionBinding): Promise<AgentConversation> {
    this.openCount += 1;
    const nativeSessionRef =
      binding.nativeSessionRef ?? `fake:${binding.conversationId}`;
    const owner = this;
    let resolvePermission: ((decision: PermissionDecision) => void) | undefined;
    return {
      nativeSessionRef,
      async *run(
        _prompt: string,
        signal: AbortSignal,
      ): AsyncIterable<RuntimeEvent> {
        owner.runCount += 1;
        if (owner.#options.permissionSummary !== undefined) {
          const requestId = newId<"PermissionRequestId">();
          const decision = new Promise<PermissionDecision>((resolve) => {
            resolvePermission = resolve;
          });
          yield {
            type: "permission_request",
            request: {
              requestId,
              summary: owner.#options.permissionSummary,
            },
          };
          const resolved = await decision;
          owner.permissionDecisions.push(resolved);
        }
        for (
          let offset = 0;
          offset < owner.#options.response.length;
          offset += owner.#options.deltaCharacters
        ) {
          signal.throwIfAborted();
          if (owner.#options.deltaDelayMs > 0) {
            await delay(owner.#options.deltaDelayMs, undefined, { signal });
          }
          yield {
            type: "text_delta",
            delta: owner.#options.response.slice(
              offset,
              offset + owner.#options.deltaCharacters,
            ),
          };
          await Promise.resolve();
        }
        yield { type: "done" };
      },
      cancel: async (_requestId: RequestId): Promise<void> => {
        owner.cancelCount += 1;
      },
      resolvePermission: async (
        _requestId: PermissionRequestId,
        decision: PermissionDecision,
      ): Promise<void> => {
        if (!resolvePermission) {
          throw new Error("no permission request is pending");
        }
        resolvePermission(decision);
        resolvePermission = undefined;
      },
      close: async (): Promise<void> => {
        owner.closeCount += 1;
      },
    };
  }
}
