import { randomUUID } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";

declare const brand: unique symbol;

export type BrandedId<Name extends string> = string & {
  readonly [brand]: Name;
};

export type DeviceId = BrandedId<"DeviceId">;
export type ConnectorId = BrandedId<"ConnectorId">;
export type ConnectionId = BrandedId<"ConnectionId">;
export type ConversationId = BrandedId<"ConversationId">;
export type TurnId = BrandedId<"TurnId">;
export type RequestId = BrandedId<"RequestId">;
export type AudioStreamId = BrandedId<"AudioStreamId">;
export type PermissionRequestId = BrandedId<"PermissionRequestId">;

export const OpaqueIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
});

export type OpaqueId = Static<typeof OpaqueIdSchema>;

export function newId<Name extends string>(): BrandedId<Name> {
  return randomUUID() as BrandedId<Name>;
}

export function asId<Name extends string>(value: string): BrandedId<Name> {
  return value as BrandedId<Name>;
}
