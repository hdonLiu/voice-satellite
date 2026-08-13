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

The initial `connector.hello` uses `seq = 0` and omits `connectionId`. Relay
assigns `connectionId` in `connector.welcome`; every later message must carry it
and use a strictly increasing connection-local control sequence. Connector sends
`connector.ready` only after its single local AgentRuntime is healthy.

Relay marks the Connector routable only after `connector.ready`.

v1 does not negotiate Agent capabilities. A conforming Connector/AgentRuntime
must implement monotonic text deltas, cancellation, local session resume,
filtered status, and structured permission events. An implementation missing a
mandatory operation is not v1-compatible and must not send `connector.ready`.

One Connector activates exactly one locally configured AgentRuntime. Connector
Link does not contain `agentId`, `agentAlias`, `backend`, native session key, or
any other field that lets Relay select an agent.

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

| Type                 | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `connector.welcome`  | Accept negotiation and assign the connection identity            |
| `agent.run`          | Run one final transcript against the locally bound agent session |
| `agent.cancel`       | Cancel the active request                                        |
| `permission.resolve` | Resolve a still-valid permission request                         |
| `ping`               | Heartbeat                                                        |

## Connector to Relay

| Type                       | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `connector.hello`          | Validate protocol version and report diagnostic software version |
| `connector.ready`          | Announce local agent readiness                                   |
| `agent.accepted`           | Confirm responsibility for a request                             |
| `agent.text_delta`         | Monotonic user-visible assistant text delta                      |
| `agent.status`             | Filtered user-safe status                                        |
| `agent.permission_request` | Structured approval request                                      |
| `agent.done`               | Terminal successful/cancelled state                              |
| `agent.error`              | Terminal stable error                                            |
| `pong`                     | Heartbeat response                                               |

## Session isolation

Relay provides `conversationId`, never a native agent session ID. Connector maps
the logical ID to a locally authorized session in its single configured runtime.
Remote inputs cannot select the agent implementation, native endpoint,
credential, workspace, filesystem path, or session key.

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
