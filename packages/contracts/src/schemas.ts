import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { STABLE_ERROR_CODES } from "./errors.js";
import { OpaqueIdSchema } from "./ids.js";

const StrictObject = <T extends Parameters<typeof Type.Object>[0]>(
  properties: T,
) => Type.Object(properties, { additionalProperties: false });

const ProtocolVersionSchema = Type.Literal(1);
const SequenceSchema = Type.Integer({ minimum: 0, maximum: 0xffff_ffff });
const DiagnosticsSchema = StrictObject({
  platform: Type.Optional(Type.String({ maxLength: 64 })),
  board: Type.Optional(Type.String({ maxLength: 64 })),
  softwareVersion: Type.Optional(Type.String({ maxLength: 64 })),
  buildProfile: Type.Optional(Type.String({ maxLength: 64 })),
});
const StableErrorCodeSchema = Type.Union(
  STABLE_ERROR_CODES.map((code) => Type.Literal(code)),
);
const EmptyPayloadSchema = StrictObject({});

export const DeviceHelloSchema = StrictObject({
  v: ProtocolVersionSchema,
  type: Type.Literal("device.hello"),
  seq: Type.Literal(0),
  payload: StrictObject({
    physicalApproval: Type.Boolean(),
    diagnostics: Type.Optional(DiagnosticsSchema),
  }),
});

export const DeviceWelcomeSchema = StrictObject({
  v: ProtocolVersionSchema,
  type: Type.Literal("device.welcome"),
  connectionId: OpaqueIdSchema,
  seq: SequenceSchema,
  conversationId: OpaqueIdSchema,
  payload: StrictObject({ connectorOnline: Type.Boolean() }),
});

const DeviceTurnEnvelope = {
  v: ProtocolVersionSchema,
  connectionId: OpaqueIdSchema,
  seq: SequenceSchema,
  conversationId: OpaqueIdSchema,
  turnId: OpaqueIdSchema,
};

export const TurnStartSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("turn.start"),
  payload: StrictObject({
    audioStreamId: OpaqueIdSchema,
    endpointing: Type.Optional(
      Type.Union([Type.Literal("device"), Type.Literal("server")]),
    ),
  }),
});
export const TurnInputEndSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("turn.input_end"),
  payload: EmptyPayloadSchema,
});
export const TurnCancelSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("turn.cancel"),
  payload: EmptyPayloadSchema,
});
export const PermissionResolveSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("permission.resolve"),
  payload: StrictObject({
    requestId: OpaqueIdSchema,
    decision: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
  }),
});

export const TurnAcceptedSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("turn.accepted"),
  payload: EmptyPayloadSchema,
});
export const TurnStateSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("turn.state"),
  payload: StrictObject({
    state: Type.Union(
      [
        "NEW",
        "CAPTURING",
        "TRANSCRIBING",
        "WAITING_AGENT",
        "SPEAKING",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
      ].map((state) => Type.Literal(state)),
    ),
  }),
});
export const TurnInputStopSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("turn.input_stop"),
  payload: StrictObject({
    reason: Type.Union(
      ["speech_end", "no_speech", "max_duration"].map((reason) =>
        Type.Literal(reason),
      ),
    ),
  }),
});
export const TranscriptFinalSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("transcript.final"),
  payload: StrictObject({
    text: Type.String({ minLength: 1, maxLength: 16_384 }),
  }),
});
export const AudioStartSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("audio.start"),
  payload: StrictObject({ audioStreamId: OpaqueIdSchema }),
});
export const AudioEndSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("audio.end"),
  payload: StrictObject({ audioStreamId: OpaqueIdSchema }),
});
export const DevicePermissionRequestSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("permission.request"),
  payload: StrictObject({
    requestId: OpaqueIdSchema,
    summary: Type.String({ minLength: 1, maxLength: 512 }),
  }),
});
export const TurnDoneSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("turn.done"),
  payload: EmptyPayloadSchema,
});
export const TurnErrorSchema = StrictObject({
  ...DeviceTurnEnvelope,
  type: Type.Literal("turn.error"),
  payload: StrictObject({
    code: StableErrorCodeSchema,
    message: Type.String({ maxLength: 512 }),
  }),
});

const DeviceHeartbeatEnvelope = {
  v: ProtocolVersionSchema,
  connectionId: OpaqueIdSchema,
  seq: SequenceSchema,
};
export const DevicePingSchema = StrictObject({
  ...DeviceHeartbeatEnvelope,
  type: Type.Literal("ping"),
  payload: StrictObject({ timestampMs: Type.Integer({ minimum: 0 }) }),
});
export const DevicePongSchema = StrictObject({
  ...DeviceHeartbeatEnvelope,
  type: Type.Literal("pong"),
  payload: StrictObject({ timestampMs: Type.Integer({ minimum: 0 }) }),
});

export const ConnectorHelloSchema = StrictObject({
  v: ProtocolVersionSchema,
  type: Type.Literal("connector.hello"),
  seq: Type.Literal(0),
  payload: StrictObject({
    softwareVersion: Type.String({ minLength: 1, maxLength: 64 }),
  }),
});
export const ConnectorWelcomeSchema = StrictObject({
  v: ProtocolVersionSchema,
  type: Type.Literal("connector.welcome"),
  connectionId: OpaqueIdSchema,
  seq: SequenceSchema,
  payload: EmptyPayloadSchema,
});

const ConnectorEnvelope = {
  v: ProtocolVersionSchema,
  connectionId: OpaqueIdSchema,
  seq: SequenceSchema,
};
const AgentTurnEnvelope = {
  ...ConnectorEnvelope,
  deviceId: OpaqueIdSchema,
  conversationId: OpaqueIdSchema,
  turnId: OpaqueIdSchema,
  requestId: OpaqueIdSchema,
};

export const ConnectorReadySchema = StrictObject({
  ...ConnectorEnvelope,
  type: Type.Literal("connector.ready"),
  payload: EmptyPayloadSchema,
});
export const AgentRunSchema = StrictObject({
  ...AgentTurnEnvelope,
  type: Type.Literal("agent.run"),
  payload: StrictObject({
    text: Type.String({ minLength: 1, maxLength: 16_384 }),
    deadlineMs: Type.Integer({ minimum: 1, maximum: 300_000 }),
  }),
});
export const AgentCancelSchema = StrictObject({
  ...AgentTurnEnvelope,
  type: Type.Literal("agent.cancel"),
  payload: EmptyPayloadSchema,
});
export const AgentPermissionResolveSchema = StrictObject({
  ...AgentTurnEnvelope,
  type: Type.Literal("agent.permission_resolve"),
  payload: StrictObject({
    permissionRequestId: OpaqueIdSchema,
    decision: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
  }),
});
export const AgentAcceptedSchema = StrictObject({
  ...AgentTurnEnvelope,
  type: Type.Literal("agent.accepted"),
  payload: EmptyPayloadSchema,
});
export const AgentTextDeltaSchema = StrictObject({
  ...AgentTurnEnvelope,
  type: Type.Literal("agent.text_delta"),
  payload: StrictObject({
    delta: Type.String({ minLength: 1, maxLength: 16_384 }),
  }),
});
export const AgentStatusSchema = StrictObject({
  ...AgentTurnEnvelope,
  type: Type.Literal("agent.status"),
  payload: StrictObject({
    status: Type.String({ minLength: 1, maxLength: 256 }),
  }),
});
export const AgentPermissionRequestSchema = StrictObject({
  ...AgentTurnEnvelope,
  type: Type.Literal("agent.permission_request"),
  payload: StrictObject({
    permissionRequestId: OpaqueIdSchema,
    summary: Type.String({ minLength: 1, maxLength: 512 }),
  }),
});
export const AgentDoneSchema = StrictObject({
  ...AgentTurnEnvelope,
  type: Type.Literal("agent.done"),
  payload: EmptyPayloadSchema,
});
export const AgentErrorSchema = StrictObject({
  ...AgentTurnEnvelope,
  type: Type.Literal("agent.error"),
  payload: StrictObject({
    code: StableErrorCodeSchema,
    message: Type.String({ maxLength: 512 }),
  }),
});
export const ConnectorPingSchema = StrictObject({
  ...ConnectorEnvelope,
  type: Type.Literal("ping"),
  payload: StrictObject({ timestampMs: Type.Integer({ minimum: 0 }) }),
});
export const ConnectorPongSchema = StrictObject({
  ...ConnectorEnvelope,
  type: Type.Literal("pong"),
  payload: StrictObject({ timestampMs: Type.Integer({ minimum: 0 }) }),
});

export const DeviceToRelaySchema = Type.Union([
  DeviceHelloSchema,
  TurnStartSchema,
  TurnInputEndSchema,
  TurnCancelSchema,
  PermissionResolveSchema,
  DevicePongSchema,
]);
export const RelayToDeviceSchema = Type.Union([
  DeviceWelcomeSchema,
  TurnAcceptedSchema,
  TurnStateSchema,
  TurnInputStopSchema,
  TranscriptFinalSchema,
  AudioStartSchema,
  AudioEndSchema,
  DevicePermissionRequestSchema,
  TurnDoneSchema,
  TurnErrorSchema,
  DevicePingSchema,
]);
export const RelayToConnectorSchema = Type.Union([
  ConnectorWelcomeSchema,
  AgentRunSchema,
  AgentCancelSchema,
  AgentPermissionResolveSchema,
  ConnectorPingSchema,
]);
export const ConnectorToRelaySchema = Type.Union([
  ConnectorHelloSchema,
  ConnectorReadySchema,
  AgentAcceptedSchema,
  AgentTextDeltaSchema,
  AgentStatusSchema,
  AgentPermissionRequestSchema,
  AgentDoneSchema,
  AgentErrorSchema,
  ConnectorPongSchema,
]);

export type DeviceHello = Static<typeof DeviceHelloSchema>;
export type DeviceWelcome = Static<typeof DeviceWelcomeSchema>;
export type DeviceToRelayMessage = Static<typeof DeviceToRelaySchema>;
export type RelayToDeviceMessage = Static<typeof RelayToDeviceSchema>;
export type ConnectorHello = Static<typeof ConnectorHelloSchema>;
export type ConnectorWelcome = Static<typeof ConnectorWelcomeSchema>;
export type RelayToConnectorMessage = Static<typeof RelayToConnectorSchema>;
export type ConnectorToRelayMessage = Static<typeof ConnectorToRelaySchema>;
export type AgentRun = Static<typeof AgentRunSchema>;

export class ProtocolValidationError extends Error {
  public constructor(public readonly issues: readonly string[]) {
    super(`invalid protocol message: ${issues.join("; ")}`);
    this.name = "ProtocolValidationError";
  }
}

export function parseSchema<T extends TSchema>(
  schema: T,
  value: unknown,
): Static<T> {
  if (Value.Check(schema, value)) return value as Static<T>;
  const issues = [...Value.Errors(schema, value)]
    .slice(0, 8)
    .map((issue) => `${issue.path || "/"}: ${issue.message}`);
  throw new ProtocolValidationError(issues);
}

export function parseJsonSchema<T extends TSchema>(
  schema: T,
  raw: string,
): Static<T> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new ProtocolValidationError([
      error instanceof Error
        ? `/: invalid JSON: ${error.message}`
        : "/: invalid JSON",
    ]);
  }
  return parseSchema(schema, value);
}
