import type {
  PermissionDecision,
  PermissionRequestId,
  RequestId,
  StableErrorCode,
} from "@voice-satellite/contracts";

export interface RuntimeHealth {
  readonly ready: boolean;
  readonly detail?: string;
}

export interface SessionBinding {
  readonly conversationId: string;
  readonly nativeSessionRef?: string;
}

export type RuntimeEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "status"; readonly status: string }
  | {
      readonly type: "permission_request";
      readonly request: {
        readonly requestId: PermissionRequestId;
        readonly summary: string;
      };
    }
  | { readonly type: "done" }
  | {
      readonly type: "error";
      readonly code: StableErrorCode;
      readonly message: string;
    };

export interface AgentConversation {
  readonly nativeSessionRef: string;
  run(prompt: string, signal: AbortSignal): AsyncIterable<RuntimeEvent>;
  cancel(requestId: RequestId): Promise<void>;
  resolvePermission(
    requestId: PermissionRequestId,
    decision: PermissionDecision,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface AgentRuntimePort {
  health(): Promise<RuntimeHealth>;
  open(binding: SessionBinding): Promise<AgentConversation>;
}
