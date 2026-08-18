import type {
  ConversationId,
  DeviceId,
  TurnId,
} from "@voice-satellite/contracts";

export interface RecognizedTranscript {
  readonly deviceId: DeviceId;
  readonly conversationId: ConversationId;
  readonly turnId: TurnId;
  readonly text: string;
}

export interface TranscriptSinkPort {
  publish(transcript: RecognizedTranscript, signal: AbortSignal): Promise<void>;
}
