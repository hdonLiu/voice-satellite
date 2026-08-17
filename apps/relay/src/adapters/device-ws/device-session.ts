import {
  DeviceToRelaySchema,
  type AudioFrame,
  type AudioStreamId,
  type ConnectionId,
  type ConversationId,
  type DeviceId,
  type PermissionDecision,
  type PermissionRequest,
  type TurnId,
  type TurnPhase,
  type TurnResult,
  VoiceSatelliteError,
  asId,
  decodeAudioWireFrame,
  encodeAudioWireFrame,
  parseJsonSchema,
  toStableError,
} from "@voice-satellite/contracts";
import type WebSocket from "ws";
import { nextWithSignal } from "../../application/async.js";
import { BoundedAsyncQueue } from "../../application/bounded-async-queue.js";
import { TurnOrchestrator } from "../../application/turn-orchestrator.js";
import type { TurnRegistry } from "../../application/turn-registry.js";
import {
  IncomingSequence,
  OutgoingSequence,
  rawDataToBytes,
  rawDataToText,
  sendBinary,
  sendJson,
} from "../../infrastructure/link-utils.js";
import type { AgentPort } from "../../ports/agent.js";
import type { DeviceOutputPort } from "../../ports/device-output.js";
import type { StreamingAsrPort, StreamingTtsPort } from "../../ports/speech.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

interface ActiveTurn {
  readonly turnId: TurnId;
  readonly inputStreamId: AudioStreamId;
  readonly audio: BoundedAsyncQueue<AudioFrame>;
  readonly abort: AbortController;
  lastAudioSequence: number;
  permission?: {
    readonly requestId: string;
    readonly deferred: Deferred<PermissionDecision>;
    readonly timer: NodeJS.Timeout;
  };
}

export interface DeviceSessionOptions {
  readonly audioQueueFrames?: number;
  readonly permissionTimeoutMs?: number;
  readonly turnTimeoutMs?: number;
  readonly agentTimeoutMs?: number;
  readonly linkOnly?: boolean;
}

export class DeviceSession implements DeviceOutputPort {
  readonly #incoming = new IncomingSequence();
  readonly #outgoing = new OutgoingSequence();
  readonly #audioQueueFrames: number;
  readonly #permissionTimeoutMs: number;
  readonly #turnTimeoutMs: number;
  readonly #orchestrator: TurnOrchestrator | undefined;
  readonly #linkOnly: boolean;
  #active: ActiveTurn | undefined;
  #closed = false;

  public constructor(
    private readonly socket: WebSocket,
    private readonly deviceId: DeviceId,
    private readonly connectionId: ConnectionId,
    private readonly conversationId: ConversationId,
    private readonly physicalApproval: boolean,
    registry: TurnRegistry,
    asr: StreamingAsrPort | undefined,
    agent: AgentPort,
    tts: StreamingTtsPort | undefined,
    options: DeviceSessionOptions = {},
  ) {
    this.#audioQueueFrames = options.audioQueueFrames ?? 250;
    this.#permissionTimeoutMs = options.permissionTimeoutMs ?? 20_000;
    this.#turnTimeoutMs = options.turnTimeoutMs ?? 120_000;
    this.#linkOnly = options.linkOnly ?? false;
    if (!this.#linkOnly) {
      if (!asr || !tts) {
        throw new Error("conversation DeviceSession requires ASR and TTS");
      }
      this.#orchestrator = new TurnOrchestrator(
        registry,
        asr,
        agent,
        tts,
        this,
        {
          turnTimeoutMs: this.#turnTimeoutMs,
          agentTimeoutMs: options.agentTimeoutMs ?? 60_000,
        },
      );
    }
  }

  public async welcome(connectorOnline: boolean): Promise<void> {
    this.#incoming.accept(0);
    this.socket.on("message", (data, isBinary) => {
      void (
        isBinary
          ? this.#receiveAudio(rawDataToBytes(data))
          : this.#receiveControl(rawDataToText(data))
      ).catch((error) => this.#protocolFailure(error));
    });
    this.socket.once("close", () => this.close());
    this.socket.once("error", () => this.close());
    await sendJson(this.socket, {
      v: 1,
      type: "device.welcome",
      connectionId: this.connectionId,
      seq: this.#outgoing.take(),
      conversationId: this.conversationId,
      payload: { connectorOnline },
    });
  }

  public close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const error = new VoiceSatelliteError("cancelled", "device disconnected");
    this.#active?.abort.abort(error);
    this.#active?.audio.fail(error);
    if (this.#active?.permission) {
      clearTimeout(this.#active.permission.timer);
      this.#active.permission.deferred.resolve("deny");
    }
    this.#active = undefined;
  }

  public async state(turnId: TurnId, state: TurnPhase): Promise<void> {
    await this.#sendTurn("turn.state", turnId, { state });
  }

  public async transcript(turnId: TurnId, text: string): Promise<void> {
    await this.#sendTurn("transcript.final", turnId, { text });
  }

  public async audio(
    turnId: TurnId,
    frames: AsyncIterable<AudioFrame>,
  ): Promise<void> {
    let streamId: AudioStreamId | undefined;
    for await (const frame of frames) {
      if (streamId === undefined) {
        streamId = frame.streamId;
        await this.#sendTurn("audio.start", turnId, {
          audioStreamId: streamId,
        });
      } else if (frame.streamId !== streamId) {
        throw new VoiceSatelliteError(
          "invalid_message",
          "TTS changed audio stream id mid-response",
        );
      }
      await sendBinary(
        this.socket,
        encodeAudioWireFrame({
          direction: "output",
          sequence: frame.sequence,
          timestampMs: frame.timestampMs,
          streamId: frame.streamId,
          payload: frame.data,
        }),
      );
    }
    if (streamId)
      await this.#sendTurn("audio.end", turnId, { audioStreamId: streamId });
  }

  public async permission(
    request: PermissionRequest,
  ): Promise<PermissionDecision> {
    if (!this.physicalApproval) return "deny";
    const active = this.#active;
    if (!active || active.turnId !== request.turnId || active.permission)
      return "deny";
    const deferred = createDeferred<PermissionDecision>();
    const timer = setTimeout(
      () => deferred.resolve("deny"),
      this.#permissionTimeoutMs,
    );
    active.permission = { requestId: request.requestId, deferred, timer };
    await this.#sendTurn("permission.request", request.turnId, {
      requestId: request.requestId,
      summary: request.summary,
    });
    const decision = await deferred.promise;
    clearTimeout(timer);
    if (active.permission?.requestId === request.requestId)
      delete active.permission;
    return decision;
  }

  public async finish(turnId: TurnId, result: TurnResult): Promise<void> {
    if (result.status === "completed") {
      await this.#sendTurn("turn.done", turnId, {});
      return;
    }
    if (result.status === "cancelled") {
      await this.#sendTurn("turn.error", turnId, {
        code: "cancelled",
        message: "turn cancelled",
      });
      return;
    }
    await this.#sendTurn("turn.error", turnId, {
      code: result.code,
      message: result.message,
    });
  }

  async #receiveControl(raw: string): Promise<void> {
    const message = parseJsonSchema(DeviceToRelaySchema, raw);
    if (message.type === "device.hello")
      throw new VoiceSatelliteError(
        "invalid_message",
        "duplicate device hello",
      );
    if (message.connectionId !== this.connectionId)
      throw new VoiceSatelliteError(
        "invalid_message",
        "device connection id mismatch",
      );
    this.#incoming.accept(message.seq);
    if (message.type === "pong") return;
    if (message.conversationId !== this.conversationId)
      throw new VoiceSatelliteError(
        "invalid_message",
        "conversation id mismatch",
      );
    switch (message.type) {
      case "turn.start":
        await this.#startTurn(
          asId<"TurnId">(message.turnId),
          asId<"AudioStreamId">(message.payload.audioStreamId),
        );
        break;
      case "turn.input_end":
        this.#requireTurn(message.turnId).audio.close();
        break;
      case "turn.cancel": {
        const active = this.#requireTurn(message.turnId);
        active.abort.abort(
          new DOMException("device cancelled turn", "AbortError"),
        );
        active.audio.close();
        break;
      }
      case "permission.resolve": {
        const active = this.#requireTurn(message.turnId);
        if (
          !active.permission ||
          active.permission.requestId !== message.payload.requestId
        ) {
          throw new VoiceSatelliteError(
            "invalid_state",
            "permission request is not active",
          );
        }
        active.permission.deferred.resolve(message.payload.decision);
        break;
      }
    }
  }

  async #receiveAudio(raw: Uint8Array): Promise<void> {
    const active = this.#active;
    if (!active)
      throw new VoiceSatelliteError(
        "invalid_state",
        "audio arrived without an active turn",
      );
    const wire = decodeAudioWireFrame(raw);
    if (wire.direction !== "input" || wire.streamId !== active.inputStreamId) {
      throw new VoiceSatelliteError(
        "invalid_message",
        "audio stream routing mismatch",
      );
    }
    if (wire.sequence !== active.lastAudioSequence + 1) {
      throw new VoiceSatelliteError(
        "invalid_message",
        "audio sequence is not contiguous",
      );
    }
    if (active.audio.size >= this.#audioQueueFrames) {
      throw new VoiceSatelliteError(
        "backpressure",
        "device audio queue is full",
      );
    }
    active.lastAudioSequence = wire.sequence;
    await active.audio.push({
      streamId: wire.streamId,
      sequence: wire.sequence,
      timestampMs: wire.timestampMs,
      data: wire.payload,
    });
  }

  async #startTurn(
    turnId: TurnId,
    inputStreamId: AudioStreamId,
  ): Promise<void> {
    if (this.#active)
      throw new VoiceSatelliteError(
        "busy",
        "device already has an active turn",
      );
    const active: ActiveTurn = {
      turnId,
      inputStreamId,
      audio: new BoundedAsyncQueue<AudioFrame>(this.#audioQueueFrames),
      abort: new AbortController(),
      lastAudioSequence: -1,
    };
    this.#active = active;
    await this.#sendTurn("turn.accepted", turnId, {});
    const run = this.#linkOnly
      ? this.#runLinkTurn(active)
      : this.#orchestrator!.run({
          deviceId: this.deviceId,
          conversationId: this.conversationId,
          turnId,
          audio: active.audio,
          signal: active.abort.signal,
        });
    void run.finally(() => {
      if (this.#active === active) this.#active = undefined;
    });
  }

  async #runLinkTurn(active: ActiveTurn): Promise<TurnResult> {
    const timeout = AbortSignal.timeout(this.#turnTimeoutMs);
    const signal = AbortSignal.any([active.abort.signal, timeout]);
    const frames = active.audio[Symbol.asyncIterator]();
    let frameCount = 0;
    let bytes = 0;
    let durationMs = 0;
    try {
      await this.state(active.turnId, "CAPTURING");
      while (true) {
        const next = await nextWithSignal(frames, signal);
        if (next.done) break;
        frameCount += 1;
        bytes += next.value.data.byteLength;
        durationMs = Math.max(durationMs, next.value.timestampMs + 20);
      }
      if (frameCount === 0) {
        throw new VoiceSatelliteError(
          "invalid_message",
          "device link turn contained no audio",
        );
      }
      console.info(
        JSON.stringify({
          event: "device_link_audio_received",
          frames: frameCount,
          bytes,
          durationMs,
        }),
      );
      const result: TurnResult = { status: "completed", transcript: "" };
      await this.state(active.turnId, "COMPLETED");
      await this.finish(active.turnId, result);
      return result;
    } catch (error) {
      const stable = timeout.aborted
        ? new VoiceSatelliteError("timeout", "device link turn timed out", {
            cause: error,
          })
        : toStableError(error);
      const result: TurnResult =
        stable.code === "cancelled"
          ? { status: "cancelled" }
          : {
              status: "failed",
              code: stable.code,
              message: stable.message,
            };
      await this.state(
        active.turnId,
        result.status === "cancelled" ? "CANCELLED" : "FAILED",
      );
      await this.finish(active.turnId, result);
      return result;
    } finally {
      await frames.return?.();
    }
  }

  #requireTurn(turnId: string): ActiveTurn {
    if (!this.#active || this.#active.turnId !== turnId) {
      throw new VoiceSatelliteError("invalid_state", "turn is not active");
    }
    return this.#active;
  }

  async #sendTurn(
    type: string,
    turnId: TurnId,
    payload: object,
  ): Promise<void> {
    if (this.#closed) return;
    await sendJson(this.socket, {
      v: 1,
      type,
      connectionId: this.connectionId,
      seq: this.#outgoing.take(),
      conversationId: this.conversationId,
      turnId,
      payload,
    });
  }

  #protocolFailure(error: unknown): void {
    const stable =
      error instanceof VoiceSatelliteError
        ? error
        : new VoiceSatelliteError("invalid_message", "invalid device message", {
            cause: error,
          });
    this.#active?.audio.fail(stable);
    this.#active?.abort.abort(stable);
    this.socket.close(
      stable.code === "backpressure" ? 4008 : 4002,
      stable.code,
    );
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
