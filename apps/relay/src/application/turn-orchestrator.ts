import {
  type AgentEvent,
  type AgentRequest,
  type AudioFrame,
  type PermissionDecision,
  type TurnRef,
  type TurnResult,
  VoiceSatelliteError,
  newId,
  toStableError,
} from "@voice-satellite/contracts";
import type { AgentPort } from "../ports/agent.js";
import type { DeviceOutputPort } from "../ports/device-output.js";
import type {
  AsrStream,
  StreamingAsrPort,
  StreamingTtsPort,
  TtsStream,
} from "../ports/speech.js";
import { nextWithSignal } from "./async.js";
import { SentenceSegmenter } from "./sentence-segmenter.js";
import { TurnRegistry } from "./turn-registry.js";

export interface TurnInput extends TurnRef {
  readonly audio: AsyncIterable<AudioFrame>;
  readonly signal?: AbortSignal;
}

export interface TurnOrchestratorOptions {
  readonly turnTimeoutMs: number;
  readonly agentTimeoutMs: number;
  readonly segmenter?: Partial<
    ConstructorParameters<typeof SentenceSegmenter>[0]
  >;
}

const DEFAULT_OPTIONS: TurnOrchestratorOptions = {
  turnTimeoutMs: 120_000,
  agentTimeoutMs: 60_000,
};

export class TurnOrchestrator {
  readonly #options: TurnOrchestratorOptions;

  public constructor(
    private readonly registry: TurnRegistry,
    private readonly asr: StreamingAsrPort,
    private readonly agent: AgentPort,
    private readonly tts: StreamingTtsPort,
    private readonly output: DeviceOutputPort,
    options: Partial<TurnOrchestratorOptions> = {},
  ) {
    this.#options = { ...DEFAULT_OPTIONS, ...options };
  }

  public async run(input: TurnInput): Promise<TurnResult> {
    this.registry.acquire(input.deviceId, input.turnId);
    const localAbort = new AbortController();
    const turnTimeout = AbortSignal.timeout(this.#options.turnTimeoutMs);
    const signal = input.signal
      ? AbortSignal.any([input.signal, localAbort.signal, turnTimeout])
      : AbortSignal.any([localAbort.signal, turnTimeout]);
    let asrStream: AsrStream | undefined;
    let ttsStream: TtsStream | undefined;
    let request: AgentRequest | undefined;
    let agentEvents: AsyncIterator<AgentEvent> | undefined;
    let inputFrames: AsyncIterator<AudioFrame> | undefined;
    let terminal: TurnResult | undefined;

    const finishOnce = async (result: TurnResult): Promise<TurnResult> => {
      if (terminal) {
        return terminal;
      }
      terminal = result;
      const phase =
        result.status === "completed"
          ? "COMPLETED"
          : result.status === "cancelled"
            ? "CANCELLED"
            : "FAILED";
      await this.output.state(input.turnId, phase);
      await this.output.finish(input.turnId, result);
      return result;
    };

    try {
      await this.output.state(input.turnId, "CAPTURING");
      asrStream = await this.asr.open(input, signal);
      inputFrames = input.audio[Symbol.asyncIterator]();
      while (true) {
        const next = await nextWithSignal(inputFrames, signal);
        if (next.done) {
          break;
        }
        await asrStream.push(next.value);
      }
      inputFrames = undefined;
      await asrStream.finish();

      await this.output.state(input.turnId, "TRANSCRIBING");
      const transcript = await this.#readFinalTranscript(
        asrStream,
        input.turnId,
        signal,
      );
      await this.output.transcript(input.turnId, transcript);

      await this.output.state(input.turnId, "WAITING_AGENT");
      request = {
        deviceId: input.deviceId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        requestId: newId<"RequestId">(),
        text: transcript,
        deadlineMs: this.#options.agentTimeoutMs,
      };
      const segmenter = new SentenceSegmenter(this.#options.segmenter);
      const agentTimeout = AbortSignal.timeout(this.#options.agentTimeoutMs);
      const agentSignal = AbortSignal.any([signal, agentTimeout]);
      agentEvents = this.agent
        .run(request, agentSignal)
        [Symbol.asyncIterator]();
      let accepted = false;
      let done = false;
      let audioPump: Promise<void> | undefined;

      const appendSegments = async (
        segments: readonly string[],
      ): Promise<void> => {
        for (const segment of segments) {
          if (!ttsStream) {
            ttsStream = await this.tts.open(input, signal);
            await this.output.state(input.turnId, "SPEAKING");
            audioPump = this.output.audio(input.turnId, ttsStream.audio);
            void audioPump.catch(() => undefined);
          }
          await ttsStream.append(segment);
        }
      };

      while (!done) {
        const next = await nextWithSignal(agentEvents, agentSignal);
        if (next.done) {
          break;
        }
        const event: AgentEvent = next.value;
        if (!accepted && event.type !== "accepted") {
          throw new VoiceSatelliteError(
            "invalid_message",
            "agent event arrived before acceptance",
          );
        }
        switch (event.type) {
          case "accepted":
            if (accepted) {
              throw new VoiceSatelliteError(
                "invalid_message",
                "duplicate agent acceptance",
              );
            }
            accepted = true;
            break;
          case "text_delta":
            await appendSegments(segmenter.append(event.delta));
            break;
          case "permission_request": {
            const decision: PermissionDecision = await this.output.permission(
              event.request,
            );
            await this.agent.resolvePermission(
              event.request.requestId,
              decision,
            );
            break;
          }
          case "status":
            break;
          case "done":
            done = true;
            break;
          case "error":
            throw new VoiceSatelliteError(event.code, event.message);
        }
      }

      if (!accepted || !done) {
        throw new VoiceSatelliteError(
          "invalid_message",
          "agent stream ended without terminal event",
        );
      }
      await agentEvents.return?.();
      agentEvents = undefined;

      await appendSegments(segmenter.flush());
      if (ttsStream) {
        await ttsStream.finish();
        await audioPump;
      }

      return await finishOnce({ status: "completed", transcript });
    } catch (error) {
      localAbort.abort(error);
      if (inputFrames?.return) {
        void inputFrames.return().catch(() => undefined);
      }
      const stable = this.#classifyFailure(error, signal, turnTimeout);
      await Promise.allSettled([
        asrStream?.cancel(),
        ttsStream?.cancel(),
        request ? this.agent.cancel(request.requestId) : undefined,
      ]);
      await Promise.allSettled([agentEvents?.return?.()]);
      if (stable.code === "cancelled") {
        return await finishOnce({ status: "cancelled" });
      }
      return await finishOnce({
        status: "failed",
        code: stable.code,
        message: stable.message,
      });
    } finally {
      this.registry.release(input.deviceId, input.turnId);
    }
  }

  async #readFinalTranscript(
    stream: AsrStream,
    turnId: TurnRef["turnId"],
    signal: AbortSignal,
  ): Promise<string> {
    let final: string | undefined;
    const events = stream.events[Symbol.asyncIterator]();
    while (true) {
      const next = await nextWithSignal(events, signal);
      if (next.done) {
        break;
      }
      if (next.value.type === "partial") {
        continue;
      }
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
        `ASR produced no final for ${turnId}`,
      );
    }
    return final;
  }

  #classifyFailure(
    error: unknown,
    signal: AbortSignal,
    timeout: AbortSignal,
  ): VoiceSatelliteError {
    if (
      timeout.aborted ||
      (signal.aborted &&
        signal.reason instanceof DOMException &&
        signal.reason.name === "TimeoutError")
    ) {
      return new VoiceSatelliteError("timeout", "turn timed out", {
        cause: error,
      });
    }
    return toStableError(error);
  }
}
