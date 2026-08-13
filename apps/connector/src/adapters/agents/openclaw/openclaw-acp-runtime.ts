import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  type AgentCapabilities,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  type PermissionDecision,
  type PermissionRequestId,
  type RequestId,
  VoiceSatelliteError,
  newId,
} from "@voice-satellite/contracts";
import { AsyncEventQueue } from "../../../infrastructure/async-event-queue.js";
import type {
  AgentConversation,
  AgentRuntimePort,
  RuntimeEvent,
  RuntimeHealth,
  SessionBinding,
} from "../../../ports/agent-runtime.js";

export interface OpenClawAcpConfig {
  readonly executable?: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly maxLineBytes?: number;
  readonly stderr?: (line: string) => void;
}

export class OpenClawAcpRuntime implements AgentRuntimePort {
  #bridge: AcpBridge | undefined;
  #starting: Promise<AcpBridge> | undefined;

  public constructor(private readonly config: OpenClawAcpConfig) {}

  public async health(): Promise<RuntimeHealth> {
    try {
      const bridge = await this.#ensureBridge();
      return bridge.alive
        ? { ready: true }
        : { ready: false, detail: "OpenClaw ACP bridge exited" };
    } catch (error) {
      return {
        ready: false,
        detail:
          error instanceof Error ? error.message : "OpenClaw ACP unavailable",
      };
    }
  }

  public async open(binding: SessionBinding): Promise<AgentConversation> {
    const bridge = await this.#ensureBridge();
    return bridge.open(binding);
  }

  public async close(): Promise<void> {
    await this.#bridge?.close();
    this.#bridge = undefined;
  }

  async #ensureBridge(): Promise<AcpBridge> {
    if (this.#bridge?.alive) return this.#bridge;
    if (this.#starting) return this.#starting;
    this.#starting = AcpBridge.start(this.config)
      .then((bridge) => {
        this.#bridge = bridge;
        return bridge;
      })
      .finally(() => {
        this.#starting = undefined;
      });
    return this.#starting;
  }
}

class AcpBridge {
  #capabilities: AgentCapabilities = {};
  readonly #conversations = new Map<string, OpenClawConversation>();

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly connection: ClientSideConnection,
    private readonly config: OpenClawAcpConfig,
  ) {}

  public static async start(config: OpenClawAcpConfig): Promise<AcpBridge> {
    const executable = config.executable ?? "openclaw";
    const child = spawn(executable, [...(config.args ?? ["acp"])], {
      cwd: config.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const spawnFailure = new Promise<never>((_, reject) =>
      child.once("error", reject),
    );
    const bridgeHolder: { value?: AcpBridge } = {};
    const client: Client = {
      requestPermission: (params) =>
        bridgeHolder.value?.requestPermission(params) ?? cancelledPermission(),
      sessionUpdate: (params) => bridgeHolder.value?.sessionUpdate(params),
    };
    const input = boundedLines(
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      config.maxLineBytes ?? 1024 * 1024,
    );
    const output = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
    const connection = new ClientSideConnection(
      () => client,
      ndJsonStream(output, input),
    );
    const bridge = new AcpBridge(child, connection, config);
    bridgeHolder.value = bridge;
    bridge.#captureStderr();
    child.once("exit", () =>
      bridge.#failAll(
        new VoiceSatelliteError(
          "connector_offline",
          "OpenClaw ACP process exited",
        ),
      ),
    );
    const initialized = connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "voice-satellite-connector", version: "0.1.0" },
    });
    const response = await Promise.race([initialized, spawnFailure]);
    if (response.protocolVersion !== 1) {
      await bridge.close();
      throw new Error(
        `OpenClaw ACP negotiated unsupported protocol ${response.protocolVersion}`,
      );
    }
    bridge.#capabilities = response.agentCapabilities ?? {};
    return bridge;
  }

  public get alive(): boolean {
    return this.child.exitCode === null && !this.child.killed;
  }

  public async open(binding: SessionBinding): Promise<AgentConversation> {
    if (!this.alive)
      throw new VoiceSatelliteError(
        "connector_offline",
        "OpenClaw ACP bridge is offline",
      );
    let sessionId: string | undefined;
    if (binding.nativeSessionRef) {
      const active = this.#conversations.get(binding.nativeSessionRef);
      if (active) return active;
    }
    if (binding.nativeSessionRef && this.#capabilities.loadSession) {
      try {
        await this.connection.loadSession({
          sessionId: binding.nativeSessionRef,
          cwd: this.config.cwd,
          mcpServers: [],
        });
        sessionId = binding.nativeSessionRef;
      } catch {
        sessionId = undefined;
      }
    }
    if (!sessionId) {
      const response = await this.connection.newSession({
        cwd: this.config.cwd,
        mcpServers: [],
        _meta: { sessionKey: `voice-satellite:${binding.conversationId}` },
      });
      sessionId = response.sessionId;
    }
    const existing = this.#conversations.get(sessionId);
    if (existing) return existing;
    const conversation = new OpenClawConversation(
      sessionId,
      this.connection,
      () => this.#conversations.delete(sessionId),
    );
    this.#conversations.set(sessionId, conversation);
    return conversation;
  }

  public async close(): Promise<void> {
    this.#failAll(
      new VoiceSatelliteError("cancelled", "OpenClaw runtime closed"),
    );
    if (this.alive) {
      this.child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) =>
          this.child.once("exit", () => resolve()),
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (this.alive) this.child.kill("SIGKILL");
    }
  }

  public sessionUpdate(params: SessionNotification): void {
    this.#conversations.get(params.sessionId)?.update(params);
  }

  public requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    return (
      this.#conversations.get(params.sessionId)?.requestPermission(params) ??
      Promise.resolve(cancelledPermission())
    );
  }

  #failAll(error: unknown): void {
    for (const conversation of this.#conversations.values())
      conversation.fail(error);
    this.#conversations.clear();
  }

  #captureStderr(): void {
    let pending = "";
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      pending = `${pending}${chunk}`.slice(-8_192);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines)
        if (line) this.config.stderr?.(line.slice(0, 2_048));
    });
  }
}

class OpenClawConversation implements AgentConversation {
  readonly #permissions = new Map<PermissionRequestId, PermissionPending>();
  #events: AsyncEventQueue<RuntimeEvent> | undefined;
  #running = false;

  public constructor(
    public readonly nativeSessionRef: string,
    private readonly connection: ClientSideConnection,
    private readonly onClose: () => void,
  ) {}

  public async *run(
    prompt: string,
    signal: AbortSignal,
  ): AsyncIterable<RuntimeEvent> {
    if (this.#running)
      throw new VoiceSatelliteError(
        "busy",
        "OpenClaw session is already running",
      );
    this.#running = true;
    const events = new AsyncEventQueue<RuntimeEvent>();
    this.#events = events;
    const onAbort = (): void =>
      void this.connection.cancel({ sessionId: this.nativeSessionRef });
    signal.addEventListener("abort", onAbort, { once: true });
    void this.connection
      .prompt({
        sessionId: this.nativeSessionRef,
        prompt: [{ type: "text", text: prompt }],
      })
      .then((response) => {
        if (response.stopReason === "cancelled") {
          events.push({
            type: "error",
            code: "cancelled",
            message: "OpenClaw turn cancelled",
          });
        } else {
          events.push({ type: "done" });
        }
        events.close();
      })
      .catch((error) =>
        events.fail(
          new VoiceSatelliteError("internal", "OpenClaw prompt failed", {
            cause: error,
          }),
        ),
      );
    try {
      for await (const event of events) yield event;
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.#events = undefined;
      this.#running = false;
      for (const pending of this.#permissions.values())
        pending.resolve(cancelledPermission());
      this.#permissions.clear();
    }
  }

  public update(params: SessionNotification): void {
    const update = params.update;
    if (
      update.sessionUpdate === "agent_message_chunk" &&
      update.content.type === "text" &&
      update.content.text
    ) {
      this.#events?.push({ type: "text_delta", delta: update.content.text });
      return;
    }
    if (update.sessionUpdate === "tool_call" && update.title) {
      this.#events?.push({
        type: "status",
        status: update.title.slice(0, 256),
      });
    }
  }

  public requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    if (!this.#events) return Promise.resolve(cancelledPermission());
    const requestId = newId<"PermissionRequestId">();
    const promise = new Promise<RequestPermissionResponse>((resolve) => {
      this.#permissions.set(requestId, { params, resolve });
    });
    this.#events.push({
      type: "permission_request",
      request: {
        requestId,
        summary:
          params.toolCall.title?.slice(0, 512) || "OpenClaw tool request",
      },
    });
    return promise;
  }

  public async cancel(_requestId: RequestId): Promise<void> {
    await this.connection.cancel({ sessionId: this.nativeSessionRef });
  }

  public async resolvePermission(
    requestId: PermissionRequestId,
    decision: PermissionDecision,
  ): Promise<void> {
    const pending = this.#permissions.get(requestId);
    if (!pending)
      throw new VoiceSatelliteError(
        "invalid_state",
        "OpenClaw permission request is inactive",
      );
    this.#permissions.delete(requestId);
    const preferredKinds =
      decision === "allow"
        ? ["allow_once", "allow_always"]
        : ["reject_once", "reject_always"];
    const option = preferredKinds
      .map((kind) =>
        pending.params.options.find((candidate) => candidate.kind === kind),
      )
      .find((candidate) => candidate !== undefined);
    pending.resolve(
      option
        ? { outcome: { outcome: "selected", optionId: option.optionId } }
        : cancelledPermission(),
    );
  }

  public async close(): Promise<void> {
    // The ACP session remains open for reuse by the next voice turn.
  }

  public fail(error: unknown): void {
    this.#events?.fail(error);
    for (const pending of this.#permissions.values())
      pending.resolve(cancelledPermission());
    this.#permissions.clear();
    this.onClose();
  }
}

interface PermissionPending {
  readonly params: RequestPermissionRequest;
  resolve(response: RequestPermissionResponse): void;
}

function cancelledPermission(): RequestPermissionResponse {
  return { outcome: { outcome: "cancelled" } };
}

function boundedLines(
  input: ReadableStream<Uint8Array>,
  maxLineBytes: number,
): ReadableStream<Uint8Array> {
  const reader = input.getReader();
  let bytesSinceNewline = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      for (const byte of next.value) {
        bytesSinceNewline = byte === 0x0a ? 0 : bytesSinceNewline + 1;
        if (bytesSinceNewline > maxLineBytes) {
          controller.error(
            new VoiceSatelliteError(
              "invalid_message",
              "ACP line exceeds maximum size",
            ),
          );
          await reader.cancel();
          return;
        }
      }
      controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
