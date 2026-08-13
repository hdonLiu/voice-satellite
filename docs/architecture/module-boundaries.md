# Module boundaries

The project follows a ports-and-adapters structure inspired by the useful
separation found in modular connector projects, while defining an independent,
voice-specific domain model and protocol.

The dependency direction is always:

```text
adapters -> ports/application -> domain
```

## Device implementation modules

```text
BoardHAL | AudioFrontend | WakeDetector | VoiceTransport | DeviceView
                              ↓
                    VoiceSessionController
```

The controller is the only owner of application-state transitions. Audio data
uses preallocated rings; cross-module control uses bounded event queues.

Forbidden dependencies:

- no `openclaw`, ACP, or provider types
- no Relay implementation details
- no unbounded queues or dynamic allocation on hot audio paths

## Relay modules

```text
DeviceGateway ─────┐
StreamingAsrPort ──┤
AgentPort ─────────┼──> TurnOrchestrator ──> TurnRegistry
StreamingTtsPort ──┤
DeviceOutputPort ───┘
```

Stable ports:

- `StreamingAsrPort`
- `StreamingTtsPort`
- `AgentPort`
- `DeviceOutputPort`

`AgentPort` is the only application boundary from Relay to Connector. Its v1
WSS adapter speaks Connector Link. `TurnRegistry` is an in-memory application
component, not a persistence port.

Forbidden dependencies:

- no ACP JSON-RPC or Gateway session keys
- no OpenClaw credentials
- no ESP32 GPIO or codec behavior
- no cloud-vendor errors in domain objects

## Connector modules

```text
RelayClientPort -> ConnectorCoordinator -> AgentRuntimePort
                                           -> AgentConversation
                                           -> configured Agent adapter
```

Stable ports:

- `RelayClientPort`
- `AgentRuntimePort`
- `SessionBindingStore`

The backend and live conversation are separate. `AgentBackend.open()` returns an
`AgentConversation` that can prompt, emit events, cancel, resolve permission,
and close.

Forbidden dependencies:

- no PCM, ASR, TTS, VAD, or ESP32 concepts
- no arbitrary remote session key selection
- no general shell, HTTP, or raw ACP proxy

## Shared domain concepts

Only these concepts cross component boundaries:

- `DeviceId`
- `ConversationId`
- `TurnId`
- `RequestId`
- `EventSeq`
- `AudioFormat`
- typed control and agent events

The native agent session identifier never appears on a public wire.

## Extension policy

v1 has four deliberate extension points:

1. board/audio adapter
2. streaming ASR adapter
3. streaming TTS adapter
4. single agent-runtime adapter

Device platforms are separated under `devices/<platform>`, with platform-specific
board adapters below them. Agent adapters are separated under
`apps/connector/src/adapters/agents/<agent>`.

Agent adapters are deployment-time alternatives. One Connector activates
exactly one adapter, and Connector Link contains no `agentId`, alias, backend
selector, or multi-agent routing. A replacement implementation must satisfy the
v1 contract instead of relying on a general capability/degradation matrix.

This extension policy means replaceable implementations, not horizontal Relay
scaling. v1 has one Relay process and reconstructs service at the next turn
after a restart; it does not coordinate active turns across Relay instances.
