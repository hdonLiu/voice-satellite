# Connector Link v1

- Status: Draft
- Transport: WebSocket over TLS
- Frames: UTF-8 JSON text frames

Connector Link is a narrow agent-command and event protocol between Relay and a
Connector running on an authorized user's computer. It is not ACP and does not
allow raw ACP, arbitrary HTTP, shell commands, or arbitrary OpenClaw session
selection.

## Connection

Connector initiates the WSS connection and sends `connector.hello`. Credentials
are scoped separately from device credentials and are placed in the
`Authorization` header, never a query parameter.

Connector advertises capabilities such as:

```text
text_delta
status
cancel
resume
permission
```

Relay marks the Connector routable only after `connector.ready`.

## Envelope

```json
{
  "v": 1,
  "type": "agent.run",
  "connectionId": "opaque-connection-id",
  "seq": 18,
  "conversationId": "opaque-conversation-id",
  "turnId": "opaque-turn-id",
  "requestId": "opaque-request-id",
  "payload": {
    "text": "What is on my calendar?",
    "deadlineMs": 60000
  }
}
```

Wire DTOs are validated at adapter boundaries and converted into domain types.

## Relay to Connector

| Type | Purpose |
|---|---|
| `agent.run` | Run one final transcript against the locally bound agent session |
| `agent.cancel` | Cancel the active request |
| `permission.resolve` | Resolve a still-valid permission request |
| `ping` | Heartbeat |

## Connector to Relay

| Type | Purpose |
|---|---|
| `connector.hello` | Negotiate version and capabilities |
| `connector.ready` | Announce local agent readiness |
| `agent.accepted` | Confirm responsibility for a request |
| `agent.text_delta` | Monotonic user-visible assistant text delta |
| `agent.status` | Filtered user-safe status |
| `agent.permission_request` | Structured approval request |
| `agent.done` | Terminal successful/cancelled state |
| `agent.error` | Terminal stable error |
| `pong` | Heartbeat response |

## Session isolation

Relay provides `conversationId`, never an OpenClaw session ID. Connector maps the
logical ID to a locally authorized session. Remote inputs cannot select the
OpenClaw agent, Gateway URL, token, workspace, filesystem path, or session key.

## Delivery and replay

- Connector acknowledges a valid new request with `agent.accepted`.
- Duplicate `requestId` values are filtered within a bounded retention window.
- A request lost before acceptance may fail as offline.
- A disconnect after acceptance has uncertain execution state.
- Relay must not automatically replay an uncertain request because tools may
  have already produced side effects.
- Connector process/ACP restart fails the active request; only a new turn is run.

## Public agent events

Only semantic, user-safe information crosses the boundary:

- assistant text deltas
- coarse tool status without arguments, paths, raw output, or secrets
- explicit permission request summaries
- terminal reason and stable error

Thinking content, hidden prompts, credentials, local paths, raw tool I/O, and raw
ACP frames are not forwarded.
