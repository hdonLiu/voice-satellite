import { asId, type AudioStreamId } from "./ids.js";

export const AUDIO_WIRE_MAGIC = "VSA1";
export const AUDIO_WIRE_VERSION = 1;
export const AUDIO_WIRE_HEADER_BYTES = 40;
export const AUDIO_WIRE_MAX_PAYLOAD_BYTES = 64 * 1024;

export type AudioDirection = "input" | "output";

export interface AudioWireFrame {
  readonly direction: AudioDirection;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly streamId: AudioStreamId;
  readonly payload: Uint8Array;
}

export class AudioWireError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AudioWireError";
  }
}

export function encodeAudioWireFrame(frame: AudioWireFrame): Uint8Array {
  validateSequence(frame.sequence);
  validateTimestamp(frame.timestampMs);
  if (frame.payload.byteLength > AUDIO_WIRE_MAX_PAYLOAD_BYTES) {
    throw new AudioWireError("audio payload exceeds maximum size");
  }
  const uuid = parseUuid(frame.streamId);
  const bytes = new Uint8Array(
    AUDIO_WIRE_HEADER_BYTES + frame.payload.byteLength,
  );
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(AUDIO_WIRE_MAGIC), 0);
  view.setUint8(4, AUDIO_WIRE_VERSION);
  view.setUint8(5, frame.direction === "input" ? 0 : 1);
  view.setUint16(6, 0, false);
  view.setUint32(8, frame.sequence, false);
  view.setBigUint64(12, BigInt(frame.timestampMs), false);
  bytes.set(uuid, 20);
  view.setUint32(36, frame.payload.byteLength, false);
  bytes.set(frame.payload, AUDIO_WIRE_HEADER_BYTES);
  return bytes;
}

export function decodeAudioWireFrame(
  input: ArrayBuffer | Uint8Array,
): AudioWireFrame {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < AUDIO_WIRE_HEADER_BYTES)
    throw new AudioWireError("truncated audio header");
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== AUDIO_WIRE_MAGIC)
    throw new AudioWireError("invalid audio magic");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(4) !== AUDIO_WIRE_VERSION)
    throw new AudioWireError("unsupported audio version");
  const rawDirection = view.getUint8(5);
  if (rawDirection !== 0 && rawDirection !== 1)
    throw new AudioWireError("invalid audio direction");
  if (view.getUint16(6, false) !== 0)
    throw new AudioWireError("non-zero reserved audio flags");
  const sequence = view.getUint32(8, false);
  const timestamp = view.getBigUint64(12, false);
  if (timestamp > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AudioWireError("audio timestamp is out of range");
  const payloadLength = view.getUint32(36, false);
  if (payloadLength > AUDIO_WIRE_MAX_PAYLOAD_BYTES)
    throw new AudioWireError("audio payload exceeds maximum size");
  if (bytes.byteLength !== AUDIO_WIRE_HEADER_BYTES + payloadLength) {
    throw new AudioWireError("audio payload length mismatch");
  }
  return {
    direction: rawDirection === 0 ? "input" : "output",
    sequence,
    timestampMs: Number(timestamp),
    streamId: asId<"AudioStreamId">(formatUuid(bytes.subarray(20, 36))),
    payload: bytes.slice(AUDIO_WIRE_HEADER_BYTES),
  };
}

function validateSequence(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new AudioWireError("audio sequence is out of range");
  }
}

function validateTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AudioWireError("audio timestamp is out of range");
  }
}

function parseUuid(value: string): Uint8Array {
  const normalized = value.toLowerCase().replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    throw new AudioWireError("audio stream id must be a UUID");
  }
  return Uint8Array.from(normalized.match(/../g)!, (pair) =>
    Number.parseInt(pair, 16),
  );
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
