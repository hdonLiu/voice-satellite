# ADR 0001: Project scope and independence

- Status: Accepted
- Date: 2026-08-13

## Context

The target is a reusable open-source voice satellite, not a fork of an existing
chat bridge or an extension of XiaoZhi firmware. The device must reach OpenClaw
running on another computer without exposing that computer's Gateway publicly.

## Decision

- Build an independent ESP-IDF firmware, cloud Relay, and outbound Connector.
- Define independent Device Link and Connector Link protocols.
- Keep the core agent-neutral and provide OpenClaw ACP as the first adapter.
- Organize device implementations under `devices/<platform>` and AgentRuntime
  implementations under `apps/connector/src/adapters/agents/<agent>`.
- Activate exactly one AgentRuntime per Connector; do not implement multi-agent
  routing or remote agent selection.
- Use cc-connect only as evidence that outbound Connector and modular boundary
  patterns are useful; do not copy or implement its private interfaces.
- Keep v1 single-device, half-duplex, PCM, and single-node.

## Consequences

The project owns more code than a direct integration, but it controls security,
real-time audio behavior, protocol evolution, and future agent compatibility.
