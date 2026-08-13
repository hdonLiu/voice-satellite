import { describe, expect, it } from "vitest";
import {
  DeviceHelloSchema,
  ProtocolValidationError,
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
