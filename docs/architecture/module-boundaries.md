# Module boundaries

The project follows a ports-and-adapters structure inspired by the useful
separation found in modular connector projects, while defining an independent,
voice-specific domain model and protocol.

The dependency direction is always:

```text
adapters -> ports/application -> domain
```

## Firmware modules

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
DeviceGateway ─┐
StreamingASR ──┤
AgentPort ─────┼──> TurnOrchestrator ──> TurnRegistry
StreamingTTS ──┤
DeviceOutput ──┘
```

Stable ports:

- `StreamingAsrPort`
- `StreamingTtsPort`
- `AgentPort`
- `DeviceOutputPort`
- `TurnRepository`

Forbidden dependencies:

- no ACP JSON-RPC or Gateway session keys
- no OpenClaw credentials
- no ESP32 GPIO or codec behavior
- no cloud-vendor errors in domain objects

## Connector modules

```text
RelayClient -> ConnectorCoordinator -> AgentBackend -> AgentConversation
                                                   -> OpenClaw ACP adapter
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

The local OpenClaw ACP/Gateway session identifier never appears on a public wire.

## Extension policy

v1 has four deliberate extension points:

1. board/audio adapter
2. streaming ASR adapter
3. streaming TTS adapter
4. agent-runtime adapter

New registries and plugin systems are introduced only after a second real
implementation demonstrates a stable abstraction. Capability enums are
preferred over a large collection of optional marker interfaces.
