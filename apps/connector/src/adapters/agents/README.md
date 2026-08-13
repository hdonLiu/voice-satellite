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

Every v1 adapter maps its native API into the same mandatory semantic contract:
monotonic text deltas, cancellation, local session resume, filtered status, and
structured permission requests. An adapter that cannot satisfy the contract is
not marked ready; Relay does not maintain per-agent degradation branches.
