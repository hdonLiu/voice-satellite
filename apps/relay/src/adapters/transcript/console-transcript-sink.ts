import type {
  RecognizedTranscript,
  TranscriptSinkPort,
} from "../../ports/transcript-sink.js";

export class ConsoleTranscriptSink implements TranscriptSinkPort {
  public async publish(
    transcript: RecognizedTranscript,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    console.info(
      JSON.stringify({
        event: "transcript_forwarded",
        deviceId: transcript.deviceId,
        conversationId: transcript.conversationId,
        turnId: transcript.turnId,
        characters: Array.from(transcript.text).length,
      }),
    );
  }
}
