import { describe, expect, it } from "vitest";
import { SentenceSegmenter } from "../src/index.js";

describe("SentenceSegmenter", () => {
  it("emits monotonic Chinese sentences without replaying the tail", () => {
    const segmenter = new SentenceSegmenter({
      minCharacters: 2,
      maxCharacters: 20,
    });
    expect(segmenter.append("你好。今天")).toEqual(["你好。"]);
    expect(segmenter.append("天气不错！")).toEqual(["今天天气不错！"]);
    expect(segmenter.flush()).toEqual([]);
  });

  it("flushes an unterminated tail once", () => {
    const segmenter = new SentenceSegmenter({
      minCharacters: 2,
      maxCharacters: 20,
    });
    expect(segmenter.append("hello world")).toEqual([]);
    expect(segmenter.flush()).toEqual(["hello world"]);
    expect(segmenter.flush()).toEqual([]);
  });

  it("streams an English sentence at a period", () => {
    const segmenter = new SentenceSegmenter({
      minCharacters: 2,
      maxCharacters: 20,
    });
    expect(segmenter.append("Hello world. Next")).toEqual(["Hello world."]);
    expect(segmenter.flush()).toEqual(["Next"]);
  });
});
