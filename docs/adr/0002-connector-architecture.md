# ADR 0002: Outbound Connector with local ACP

- Status: Accepted
- Date: 2026-08-13

## Context

The OpenClaw computer may be behind NAT and must not expose its Gateway token or
operator-level APIs to the internet or to an ESP32 device.

## Decision

Run a Connector on the OpenClaw computer. It establishes an outbound WSS to the
Relay and starts `openclaw acp` locally over stdio. ACP remains an adapter detail.

The Relay sends only `run`, `cancel`, permission-resolution, and health messages.
The Connector derives allowed Gateway sessions locally and filters all ACP output
into public semantic events.

## Consequences

- No inbound port is required on the OpenClaw computer.
- OpenClaw credentials never enter the Relay or firmware.
- ACP changes are isolated to one adapter.
- Connector availability depends on the computer being awake and online.
- An accepted request with an uncertain disconnect cannot be safely replayed.
