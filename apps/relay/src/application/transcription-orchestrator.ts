import {
  type AsrEvent,
  type AudioFrame,
  type TurnRef,
  type TurnResult,
  VoiceSatelliteError,
  toStableError,
} from "@voice-satellite/contracts";
import type { DeviceOutputPort } from "../ports/device-output.js";
import type { AsrStream, StreamingAsrPort } from "../ports/speech.js";
import type { TranscriptSinkPort } from "../ports/transcript-sink.js";
import { nextWithSignal } from "./async.js";
import { TurnRegistry } from "./turn-registry.js";

export interface TranscriptionInput extends TurnRef {
  readonly audio: AsyncIterable<AudioFrame>;
  readonly signal?: AbortSignal;
}

export class TranscriptionOrchestrator {
  public constructor(
    private readonly registry: TurnRegistry,
    private readonly asr: StreamingAsrPort,
    private readonly output: DeviceOutputPort,
    private readonly sink: TranscriptSinkPort,
    private readonly turnTimeoutMs = 120_000,
  ) {}

  public async run(input: TranscriptionInput): Promise<TurnResult> {
    this.registry.acquire(input.deviceId, input.turnId);
    const timeout = AbortSignal.timeout(this.turnTimeoutMs);
    const signal = input.signal
      ? AbortSignal.any([input.signal, timeout])
      : timeout;
    let stream: AsrStream | undefined;
    let frames: AsyncIterator<AudioFrame> | undefined;

    try {
      await this.output.state(input.turnId, "CAPTURING");
      stream = await this.asr.open(input, signal);
      frames = input.audio[Symbol.asyncIterator]();
      while (true) {
        const next = await nextWithSignal(frames, signal);
        if (next.done) break;
        await stream.push(next.value);
      }
      frames = undefined;
      await this.output.state(input.turnId, "TRANSCRIBING");
      await stream.finish();
      const transcript = await readFinalTranscript(stream.events, signal);
      await this.output.transcript(input.turnId, transcript);
      await this.sink.publish(
        {
          deviceId: input.deviceId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          text: transcript,
        },
        signal,
      );
      const result: TurnResult = { status: "completed", transcript };
      await this.output.state(input.turnId, "COMPLETED");
      await this.output.finish(input.turnId, result);
      return result;
    } catch (error) {
      if (frames?.return) void frames.return().catch(() => undefined);
      await Promise.allSettled([stream?.cancel()]);
      const stable = timeout.aborted
        ? new VoiceSatelliteError("timeout", "turn timed out", { cause: error })
        : toStableError(error);
      const result: TurnResult =
        stable.code === "cancelled"
          ? { status: "cancelled" }
          : {
              status: "failed",
              code: stable.code,
              message: stable.message,
            };
      await this.output.state(
        input.turnId,
        result.status === "cancelled" ? "CANCELLED" : "FAILED",
      );
      await this.output.finish(input.turnId, result);
      return result;
    } finally {
      this.registry.release(input.deviceId, input.turnId);
    }
  }
}

async function readFinalTranscript(
  source: AsyncIterable<AsrEvent>,
  signal: AbortSignal,
): Promise<string> {
  let final: string | undefined;
  const events = source[Symbol.asyncIterator]();
  while (true) {
    const next = await nextWithSignal(events, signal);
    if (next.done) break;
    if (next.value.type === "partial") continue;
    if (final !== undefined) {
      throw new VoiceSatelliteError(
        "invalid_message",
        "ASR emitted multiple final results",
      );
    }
    final = next.value.text.trim();
  }
  if (!final) {
    throw new VoiceSatelliteError(
      "invalid_message",
      "ASR produced no final transcript",
    );
  }
  return final;
}
