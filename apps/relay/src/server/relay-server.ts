import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
} from "node:http";
import {
  ConnectorHelloSchema,
  DeviceHelloSchema,
  type ConnectorId,
  type DeviceId,
  asId,
  newId,
  parseJsonSchema,
} from "@voice-satellite/contracts";
import { WebSocket, WebSocketServer } from "ws";
import {
  RemoteAgentPort,
  bindRemoteAgentSocket,
} from "../adapters/connector-ws/remote-agent-port.js";
import {
  DeviceSession,
  type DeviceSessionOptions,
} from "../adapters/device-ws/device-session.js";
import { TurnRegistry } from "../application/turn-registry.js";
import {
  rawDataToText,
  readBearer,
  safeTokenEqual,
  sendJson,
} from "../infrastructure/link-utils.js";
import type { StreamingAsrPort, StreamingTtsPort } from "../ports/speech.js";
import type { TranscriptSinkPort } from "../ports/transcript-sink.js";

export interface RelayDeviceCredential {
  readonly deviceId: DeviceId;
  readonly token: string;
}

export interface RelayConnectorCredential {
  readonly connectorId: ConnectorId;
  readonly token: string;
}

export type RelayMode = "device-link" | "transcribe" | "conversation";

export interface RelayServerOptions extends DeviceSessionOptions {
  readonly host?: string;
  readonly port?: number;
  readonly mode?: RelayMode;
  readonly deviceCredentials: readonly RelayDeviceCredential[];
  readonly connectorCredential?: RelayConnectorCredential;
  readonly handshakeTimeoutMs?: number;
}

export class RelayServer {
  readonly #http: HttpServer;
  readonly #wss = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
    perMessageDeflate: false,
  });
  readonly #agent = new RemoteAgentPort();
  readonly #registry = new TurnRegistry();
  readonly #conversations = new Map<
    DeviceId,
    ReturnType<typeof newId<"ConversationId">>
  >();
  readonly #devices = new Set<DeviceSession>();

  public constructor(
    private readonly asr: StreamingAsrPort | undefined,
    private readonly tts: StreamingTtsPort | undefined,
    private readonly options: RelayServerOptions,
    private readonly transcriptSink?: TranscriptSinkPort,
  ) {
    if ((options.mode ?? "conversation") === "conversation") {
      if (!asr || !tts) {
        throw new Error("conversation mode requires ASR and TTS providers");
      }
      if (!options.connectorCredential) {
        throw new Error("conversation mode requires a Connector credential");
      }
    } else if (options.mode === "transcribe") {
      if (!asr || !transcriptSink) {
        throw new Error("transcribe mode requires ASR and a transcript sink");
      }
    }
    this.#http = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            mode: this.options.mode ?? "conversation",
            connectorReady: this.#agent.ready,
          }),
        );
        return;
      }
      response.writeHead(404).end();
    });
    this.#http.on("upgrade", (request, socket, head) => {
      const path = safePath(request);
      if (path !== "/v1/device" && path !== "/v1/connector") {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const principal =
        path === "/v1/device"
          ? this.#authenticateDevice(request)
          : this.#authenticateConnector(request);
      if (!principal) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.#wss.handleUpgrade(request, socket, head, (webSocket) => {
        if (path === "/v1/device")
          this.#acceptDevice(webSocket, principal as DeviceId);
        else this.#acceptConnector(webSocket);
      });
    });
  }

  public async start(): Promise<{
    readonly host: string;
    readonly port: number;
  }> {
    await new Promise<void>((resolve, reject) => {
      this.#http.once("error", reject);
      this.#http.listen(
        this.options.port ?? 8787,
        this.options.host ?? "127.0.0.1",
        () => {
          this.#http.off("error", reject);
          resolve();
        },
      );
    });
    const address = this.#http.address();
    if (!address || typeof address === "string")
      throw new Error("relay has no TCP address");
    return { host: address.address, port: address.port };
  }

  public async stop(): Promise<void> {
    for (const client of this.#wss.clients)
      client.close(1001, "server stopping");
    for (const session of this.#devices) session.close();
    this.#devices.clear();
    await new Promise<void>((resolve, reject) => {
      this.#http.close((error) => (error ? reject(error) : resolve()));
    });
    this.#wss.close();
  }

  #authenticateDevice(request: IncomingMessage): DeviceId | undefined {
    const bearer = readBearer(request.headers.authorization);
    for (const credential of this.options.deviceCredentials) {
      if (safeTokenEqual(bearer, credential.token)) return credential.deviceId;
    }
    return undefined;
  }

  #authenticateConnector(request: IncomingMessage): ConnectorId | undefined {
    if (!this.options.connectorCredential) return undefined;
    return safeTokenEqual(
      readBearer(request.headers.authorization),
      this.options.connectorCredential.token,
    )
      ? this.options.connectorCredential.connectorId
      : undefined;
  }

  #acceptDevice(socket: WebSocket, deviceId: DeviceId): void {
    withFirstTextMessage(
      socket,
      this.options.handshakeTimeoutMs ?? 5_000,
      async (raw) => {
        const hello = parseJsonSchema(DeviceHelloSchema, raw);
        const connectionId = newId<"ConnectionId">();
        const conversationId =
          this.#conversations.get(deviceId) ?? newId<"ConversationId">();
        this.#conversations.set(deviceId, conversationId);
        const session = new DeviceSession(
          socket,
          deviceId,
          connectionId,
          conversationId,
          hello.payload.physicalApproval,
          this.#registry,
          this.asr,
          this.#agent,
          this.tts,
          this.transcriptSink,
          {
            ...this.options,
            mode: this.options.mode ?? "conversation",
          },
        );
        this.#devices.add(session);
        socket.once("close", () => this.#devices.delete(session));
        await session.welcome(this.#agent.ready);
      },
    );
  }

  #acceptConnector(socket: WebSocket): void {
    withFirstTextMessage(
      socket,
      this.options.handshakeTimeoutMs ?? 5_000,
      async (raw) => {
        const hello = parseJsonSchema(ConnectorHelloSchema, raw);
        const connectionId = newId<"ConnectionId">();
        this.#agent.attach(socket, connectionId);
        this.#agent.markHello(hello.seq);
        bindRemoteAgentSocket(this.#agent, socket);
        await sendJson(socket, {
          v: 1,
          type: "connector.welcome",
          connectionId,
          seq: this.#agent.nextSequence(),
          payload: {},
        });
      },
    );
  }
}

function withFirstTextMessage(
  socket: WebSocket,
  timeoutMs: number,
  handler: (raw: string) => Promise<void>,
): void {
  const timer = setTimeout(
    () => socket.close(4001, "handshake timeout"),
    timeoutMs,
  );
  socket.once("message", (data, isBinary) => {
    clearTimeout(timer);
    if (isBinary) {
      socket.close(4002, "control hello must be text");
      return;
    }
    void handler(rawDataToText(data)).catch(() =>
      socket.close(4002, "invalid hello"),
    );
  });
}

function safePath(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? "/", "http://relay.invalid").pathname;
  } catch {
    return undefined;
  }
}

export function deviceCredential(
  deviceId: string,
  token: string,
): RelayDeviceCredential {
  return { deviceId: asId<"DeviceId">(deviceId), token };
}

export function connectorCredential(
  connectorId: string,
  token: string,
): RelayConnectorCredential {
  return { connectorId: asId<"ConnectorId">(connectorId), token };
}
