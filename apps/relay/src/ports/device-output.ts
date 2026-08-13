import type {
  AudioFrame,
  PermissionDecision,
  PermissionRequest,
  TurnId,
  TurnPhase,
  TurnResult,
} from "@voice-satellite/contracts";

export interface DeviceOutputPort {
  state(turnId: TurnId, state: TurnPhase): Promise<void>;
  transcript(turnId: TurnId, text: string): Promise<void>;
  audio(turnId: TurnId, frames: AsyncIterable<AudioFrame>): Promise<void>;
  permission(request: PermissionRequest): Promise<PermissionDecision>;
  finish(turnId: TurnId, result: TurnResult): Promise<void>;
}
