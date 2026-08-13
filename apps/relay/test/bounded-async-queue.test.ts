import { describe, expect, it } from "vitest";
import { BoundedAsyncQueue } from "../src/index.js";

describe("BoundedAsyncQueue", () => {
  it("applies backpressure until a consumer frees capacity", async () => {
    const queue = new BoundedAsyncQueue<number>(1);
    await queue.push(1);
    let released = false;
    const second = queue.push(2).then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBe(false);
    const iterator = queue[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: 1 });
    await second;
    expect(await iterator.next()).toEqual({ done: false, value: 2 });
  });

  it("finishes waiting readers when closed", async () => {
    const queue = new BoundedAsyncQueue<number>(1);
    const iterator = queue[Symbol.asyncIterator]();
    const waiting = iterator.next();
    queue.close();
    expect(await waiting).toEqual({ done: true, value: undefined });
  });
});
