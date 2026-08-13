# ADR 0004: Single-node Relay and adapter replaceability

- Status: Accepted
- Date: 2026-08-13

## Context

The phrase "horizontal extension" can mean either adding implementations for
new device/agent types or running multiple Relay instances. Those are different
requirements. Relay scale-out would require distributed connection ownership,
sticky routing or handoff, external active-turn state, and new failure semantics.

## Decision

- v1 runs one Relay process and keeps active connections and turns in memory.
- A Relay restart may fail the current turn; devices and Connectors reconnect
  and service resumes with the next turn.
- Public protocols do not expose process-local object references, but they make
  no v1 promise that an active turn can move between Relay instances.
- Device implementations are replaceable behind Device Link.
- Agent implementations are deployment-time alternatives behind
  `AgentRuntimePort`; one Connector activates one implementation.
- Documentation uses "replaceability" for these adapter properties and reserves
  "horizontal scaling" for a future multi-Relay architecture.

## Consequences

v1 avoids Redis, a durable turn queue, distributed locks, and cluster routing.
It remains straightforward to operate and test, at the cost of current-turn
loss during Relay restart and no multi-instance capacity or availability claim.
A future scale-out design requires a separate ADR and protocol/failure review.
