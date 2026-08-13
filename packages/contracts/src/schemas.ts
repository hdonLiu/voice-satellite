import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { OpaqueIdSchema } from "./ids.js";
import { STABLE_ERROR_CODES } from "./errors.js";

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
  payload: StrictObject({
    connectorOnline: Type.Boolean(),
  }),
});

const TurnEnvelope = {
  v: ProtocolVersionSchema,
  connectionId: OpaqueIdSchema,
  seq: SequenceSchema,
  conversationId: OpaqueIdSchema,
  turnId: OpaqueIdSchema,
};

export const TurnStartSchema = StrictObject({
  ...TurnEnvelope,
  type: Type.Literal("turn.start"),
  payload: StrictObject({}),
});

export const TurnInputEndSchema = StrictObject({
  ...TurnEnvelope,
  type: Type.Literal("turn.input_end"),
  payload: StrictObject({}),
});

export const TurnCancelSchema = StrictObject({
  ...TurnEnvelope,
  type: Type.Literal("turn.cancel"),
  payload: StrictObject({}),
});

export const ConnectorHelloSchema = StrictObject({
  v: ProtocolVersionSchema,
  type: Type.Literal("connector.hello"),
  seq: Type.Literal(0),
  payload: StrictObject({
    softwareVersion: Type.String({ minLength: 1, maxLength: 64 }),
  }),
});

export const ConnectorReadySchema = StrictObject({
  v: ProtocolVersionSchema,
  type: Type.Literal("connector.ready"),
  connectionId: OpaqueIdSchema,
  seq: SequenceSchema,
  payload: StrictObject({}),
});

export const AgentRunSchema = StrictObject({
  ...TurnEnvelope,
  type: Type.Literal("agent.run"),
  requestId: OpaqueIdSchema,
  payload: StrictObject({
    text: Type.String({ minLength: 1, maxLength: 16_384 }),
    deadlineMs: Type.Integer({ minimum: 1, maximum: 300_000 }),
  }),
});

export const AgentTextDeltaSchema = StrictObject({
  ...TurnEnvelope,
  type: Type.Literal("agent.text_delta"),
  requestId: OpaqueIdSchema,
  payload: StrictObject({
    delta: Type.String({ minLength: 1, maxLength: 16_384 }),
  }),
});

export const AgentErrorSchema = StrictObject({
  ...TurnEnvelope,
  type: Type.Literal("agent.error"),
  requestId: OpaqueIdSchema,
  payload: StrictObject({
    code: Type.Union(STABLE_ERROR_CODES.map((code) => Type.Literal(code))),
    message: Type.String({ maxLength: 512 }),
  }),
});

export type DeviceHello = Static<typeof DeviceHelloSchema>;
export type DeviceWelcome = Static<typeof DeviceWelcomeSchema>;
export type ConnectorHello = Static<typeof ConnectorHelloSchema>;
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
  if (Value.Check(schema, value)) {
    return value as Static<T>;
  }

  const issues = [...Value.Errors(schema, value)]
    .slice(0, 8)
    .map((issue) => `${issue.path || "/"}: ${issue.message}`);
  throw new ProtocolValidationError(issues);
}
