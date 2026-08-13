import { describe, expect, it } from "vitest";
import { asId } from "@voice-satellite/contracts";
import { RequestDedupeCache } from "../src/index.js";

describe("RequestDedupeCache", () => {
  it("expires entries and evicts the oldest entry", () => {
    let now = 0;
    const cache = new RequestDedupeCache({
      maxEntries: 2,
      ttlMs: 10,
      now: () => now,
    });
    const one = asId<"RequestId">("one");
    const two = asId<"RequestId">("two");
    const three = asId<"RequestId">("three");
    cache.add(one);
    cache.add(two);
    cache.add(three);

    expect(cache.has(one)).toBe(false);
    expect(cache.has(two)).toBe(true);
    now = 11;
    expect(cache.has(two)).toBe(false);
  });
});
