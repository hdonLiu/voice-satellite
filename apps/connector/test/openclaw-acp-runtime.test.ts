import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenClawAcpRuntime } from "../src/index.js";

describe("OpenClawAcpRuntime", () => {
  it("supervises ACP stdio and projects streamed agent text", async () => {
    const fixture = fileURLToPath(
      new URL("./fixtures/fake-acp-agent.mjs", import.meta.url),
    );
    const runtime = new OpenClawAcpRuntime({
      executable: process.execPath,
      args: [fixture],
      cwd: process.cwd(),
    });
    try {
      expect(await runtime.health()).toEqual({ ready: true });
      const conversation = await runtime.open({
        conversationId: "conversation-test",
      });
      const events = [];
      for await (const event of conversation.run(
        "hello",
        new AbortController().signal,
      )) {
        events.push(event);
      }
      expect(events).toEqual([
        { type: "text_delta", delta: "ACP response" },
        { type: "done" },
      ]);
      expect(conversation.nativeSessionRef).toContain("conversation-test");

      const reopened = await runtime.open({
        conversationId: "conversation-test",
        nativeSessionRef: conversation.nativeSessionRef,
      });
      expect(reopened.nativeSessionRef).toBe(conversation.nativeSessionRef);

      const permissionEvents = [];
      for await (const event of reopened.run(
        "permission",
        new AbortController().signal,
      )) {
        permissionEvents.push(event);
        if (event.type === "permission_request") {
          await reopened.resolvePermission(event.request.requestId, "allow");
        }
      }
      expect(permissionEvents).toEqual([
        {
          type: "permission_request",
          request: expect.objectContaining({ summary: "Run safe test" }),
        },
        { type: "text_delta", delta: "permission allowed" },
        { type: "done" },
      ]);
    } finally {
      await runtime.close();
    }
  });
});
