import {
  type AsrEvent,
  type AudioFrame,
  type AudioStreamId,
  newId,
} from "@voice-satellite/contracts";
import {
  BoundedAsyncQueue,
  type AsrContext,
  type AsrStream,
  type StreamingAsrPort,
  type StreamingTtsPort,
  type TtsContext,
  type TtsStream,
} from "@voice-satellite/relay";

export class FakeStreamingAsr implements StreamingAsrPort {
  public opened = 0;
  public framesReceived = 0;
  public cancelled = 0;

  public constructor(private readonly transcript: string) {}

  public async open(
    _context: AsrContext,
    signal: AbortSignal,
  ): Promise<AsrStream> {
    signal.throwIfAborted();
    this.opened += 1;
    const events = new BoundedAsyncQueue<AsrEvent>(4);
    let finished = false;
    return {
      events,
      push: async (_frame): Promise<void> => {
        signal.throwIfAborted();
        if (finished) {
          throw new Error("ASR input already finished");
        }
        this.framesReceived += 1;
      },
      finish: async (): Promise<void> => {
        if (finished) {
          return;
        }
        finished = true;
        await events.push({ type: "final", text: this.transcript }, signal);
        events.close();
      },
      cancel: async (): Promise<void> => {
        this.cancelled += 1;
        events.close();
      },
    };
  }
}

export class FakeStreamingTts implements StreamingTtsPort {
  public opened = 0;
  public readonly segments: string[] = [];
  public cancelled = 0;

  public async open(
    _context: TtsContext,
    signal: AbortSignal,
  ): Promise<TtsStream> {
    signal.throwIfAborted();
    this.opened += 1;
    const audio = new BoundedAsyncQueue<AudioFrame>(8);
    const streamId = newId<"AudioStreamId">() as AudioStreamId;
    let sequence = 0;
    let finished = false;
    return {
      audio,
      append: async (segment): Promise<void> => {
        signal.throwIfAborted();
        if (finished) {
          throw new Error("TTS input already finished");
        }
        this.segments.push(segment);
        await audio.push(
          {
            streamId,
            sequence: sequence++,
            timestampMs: Date.now(),
            data: new TextEncoder().encode(segment),
          },
          signal,
        );
      },
      finish: async (): Promise<void> => {
        finished = true;
        audio.close();
      },
      cancel: async (): Promise<void> => {
        this.cancelled += 1;
        audio.close();
      },
    };
  }
}
