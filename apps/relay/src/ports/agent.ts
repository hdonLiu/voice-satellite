import type {
  AgentEvent,
  AgentRequest,
  PermissionDecision,
  PermissionRequestId,
  RequestId,
} from "@voice-satellite/contracts";

export interface AgentPort {
  run(request: AgentRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
  cancel(requestId: RequestId): Promise<void>;
  resolvePermission(
    requestId: PermissionRequestId,
    decision: PermissionDecision,
  ): Promise<void>;
}
