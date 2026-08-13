# AgentRuntime adapters

Each child directory implements `AgentRuntimePort` for one agent product or
protocol integration.

```text
agents/
  openclaw/     first implementation
  other-agent/  future deployment-time replacement
```

A Connector is configured with exactly one adapter. These directories are
alternative implementations, not a runtime registry: Connector Link has no
`agentId`, alias, backend selector, or multi-agent routing message.

Every adapter maps its native API into the same semantic events and declares its
capabilities, such as streaming text, cancellation, session resume, status, and
permission requests. Unsupported capabilities degrade explicitly.
