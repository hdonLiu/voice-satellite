import type {
  ConversationId,
  DeviceId,
  PermissionRequestId,
  RequestId,
  TurnId,
} from "./ids.js";
import type { StableErrorCode } from "./errors.js";

export const TURN_PHASES = [
  "NEW",
  "CAPTURING",
  "TRANSCRIBING",
  "WAITING_AGENT",
  "SPEAKING",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
] as const;

export type TurnPhase = (typeof TURN_PHASES)[number];

export interface TurnRef {
  readonly deviceId: DeviceId;
  readonly conversationId: ConversationId;
  readonly turnId: TurnId;
}

export interface AgentRequest extends TurnRef {
  readonly requestId: RequestId;
  readonly text: string;
  readonly deadlineMs: number;
}

export interface PermissionRequest {
  readonly requestId: PermissionRequestId;
  readonly turnId: TurnId;
  readonly summary: string;
}

export type PermissionDecision = "allow" | "deny";

export type AgentEvent =
  | { readonly type: "accepted" }
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "status"; readonly status: string }
  | { readonly type: "permission_request"; readonly request: PermissionRequest }
  | { readonly type: "done" }
  | {
      readonly type: "error";
      readonly code: StableErrorCode;
      readonly message: string;
    };

export type AsrEvent =
  | { readonly type: "partial"; readonly text: string }
  | { readonly type: "final"; readonly text: string };

export type TurnResult =
  | { readonly status: "completed"; readonly transcript: string }
  | { readonly status: "cancelled" }
  | {
      readonly status: "failed";
      readonly code: StableErrorCode;
      readonly message: string;
    };
