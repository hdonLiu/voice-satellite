import type {
  AsrEvent,
  AudioFrame,
  ConversationId,
  DeviceId,
  TurnId,
} from "@voice-satellite/contracts";

export interface AsrContext {
  readonly deviceId: DeviceId;
  readonly conversationId: ConversationId;
  readonly turnId: TurnId;
}

export interface AsrStream {
  readonly events: AsyncIterable<AsrEvent>;
  push(frame: AudioFrame): Promise<void>;
  finish(): Promise<void>;
  cancel(): Promise<void>;
}

export interface StreamingAsrPort {
  open(context: AsrContext, signal: AbortSignal): Promise<AsrStream>;
}

export interface TtsContext {
  readonly deviceId: DeviceId;
  readonly conversationId: ConversationId;
  readonly turnId: TurnId;
}

export interface TtsStream {
  readonly audio: AsyncIterable<AudioFrame>;
  append(segment: string): Promise<void>;
  finish(): Promise<void>;
  cancel(): Promise<void>;
}

export interface StreamingTtsPort {
  open(context: TtsContext, signal: AbortSignal): Promise<TtsStream>;
}
