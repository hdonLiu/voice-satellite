import { describe, expect, it } from "vitest";
import {
  ConnectorToRelaySchema,
  DeviceHelloSchema,
  DeviceToRelaySchema,
  ProtocolValidationError,
  RelayToConnectorSchema,
  RelayToDeviceSchema,
  parseSchema,
} from "../src/index.js";

describe("DeviceHelloSchema", () => {
  it("accepts the minimal v1 hello payload", () => {
    const value = parseSchema(DeviceHelloSchema, {
      v: 1,
      type: "device.hello",
      seq: 0,
      payload: { physicalApproval: false },
    });

    expect(value.payload.physicalApproval).toBe(false);
  });

  it("rejects routing-relevant fields that are not in the contract", () => {
    expect(() =>
      parseSchema(DeviceHelloSchema, {
        v: 1,
        type: "device.hello",
        seq: 0,
        payload: {
          physicalApproval: true,
          inputMode: "wake_word",
        },
      }),
    ).toThrow(ProtocolValidationError);
  });
});

describe("protocol unions", () => {
  it.each([
    [
      DeviceToRelaySchema,
      {
        v: 1,
        type: "device.hello",
        seq: 0,
        payload: { physicalApproval: true },
      },
    ],
    [
      RelayToDeviceSchema,
      {
        v: 1,
        type: "device.welcome",
        connectionId: "connection-1",
        seq: 0,
        conversationId: "conversation-1",
        payload: { connectorOnline: true },
      },
    ],
    [
      RelayToConnectorSchema,
      {
        v: 1,
        type: "connector.welcome",
        connectionId: "connection-1",
        seq: 0,
        payload: {},
      },
    ],
    [
      ConnectorToRelaySchema,
      {
        v: 1,
        type: "connector.hello",
        seq: 0,
        payload: { softwareVersion: "0.1.0" },
      },
    ],
  ] as const)("accepts a valid message", (schema, message) => {
    expect(parseSchema(schema, message)).toEqual(message);
  });

  it("rejects remote Agent selection in the Connector hello", () => {
    expect(() =>
      parseSchema(ConnectorToRelaySchema, {
        v: 1,
        type: "connector.hello",
        seq: 0,
        payload: { softwareVersion: "0.1.0", agent: "openclaw" },
      }),
    ).toThrow(ProtocolValidationError);
  });
});
