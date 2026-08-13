import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pendingPermissionPrompt;

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === undefined && message.id === 100) {
    const allowed = message.result?.outcome?.outcome === "selected";
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: pendingPermissionPrompt.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: allowed ? "permission allowed" : "permission denied",
          },
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: pendingPermissionPrompt.id,
      result: { stopReason: "end_turn" },
    });
    pendingPermissionPrompt = undefined;
    return;
  }
  switch (message.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: false },
          authMethods: [],
        },
      });
      break;
    case "session/new":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: `fake-${message.params._meta.sessionKey}` },
      });
      break;
    case "session/prompt":
      if (message.params.prompt[0]?.text === "permission") {
        pendingPermissionPrompt = message;
        send({
          jsonrpc: "2.0",
          id: 100,
          method: "session/request_permission",
          params: {
            sessionId: message.params.sessionId,
            toolCall: { toolCallId: "tool-1", title: "Run safe test" },
            options: [
              { optionId: "allow", name: "Allow once", kind: "allow_once" },
              { optionId: "reject", name: "Reject once", kind: "reject_once" },
            ],
          },
        });
        break;
      }
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "ACP response" },
          },
        },
      });
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { stopReason: "end_turn" },
      });
      break;
    case "session/cancel":
      break;
    default:
      if (message.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "method not found" },
        });
      }
  }
});
