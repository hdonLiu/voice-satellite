import { timingSafeEqual } from "node:crypto";
import { VoiceSatelliteError } from "@voice-satellite/contracts";
import type WebSocket from "ws";

export class IncomingSequence {
  #expected = 0;

  public accept(sequence: number): void {
    if (sequence !== this.#expected) {
      throw new VoiceSatelliteError(
        "invalid_message",
        `expected control sequence ${this.#expected}, received ${sequence}`,
      );
    }
    this.#expected += 1;
  }
}

export class OutgoingSequence {
  #next = 0;
  public take(): number {
    if (this.#next > 0xffff_ffff)
      throw new VoiceSatelliteError("internal", "control sequence exhausted");
    return this.#next++;
  }
}

export function readBearer(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  const value = header.slice(7);
  return value.length > 0 ? value : undefined;
}

export function safeTokenEqual(
  actual: string | undefined,
  expected: string,
): boolean {
  if (actual === undefined) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export function sendJson(socket: WebSocket, value: unknown): Promise<void> {
  return send(socket, JSON.stringify(value));
}

export function sendBinary(
  socket: WebSocket,
  value: Uint8Array,
): Promise<void> {
  return send(socket, value, { binary: true });
}

function send(
  socket: WebSocket,
  data: string | Uint8Array,
  options?: { binary: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== socket.OPEN) {
      reject(
        new VoiceSatelliteError("connector_offline", "WebSocket is not open"),
      );
      return;
    }
    socket.send(data, options ?? {}, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

export function rawDataToText(data: WebSocket.RawData): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
    "utf8",
  );
}

export function rawDataToBytes(data: WebSocket.RawData): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
}
