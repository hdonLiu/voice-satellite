import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId } from "@voice-satellite/contracts";
import { describe, expect, it } from "vitest";
import { JsonFileSessionBindingStore } from "../src/index.js";

describe("JsonFileSessionBindingStore", () => {
  it("atomically persists opaque local session references", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voice-satellite-store-"));
    const path = join(directory, "sessions.json");
    const id = asId<"ConversationId">("conversation-one");
    const store = new JsonFileSessionBindingStore(path);
    await store.save({
      conversationId: id,
      nativeSessionRef: "native-secret-ref",
    });
    const reopened = new JsonFileSessionBindingStore(path);
    expect(await reopened.load(id)).toEqual({
      conversationId: id,
      nativeSessionRef: "native-secret-ref",
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 1,
    });
  });
});
