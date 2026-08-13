# Architecture overview

## Goal

Voice Satellite turns a voice-capable device into an interface for an AI agent
running on another computer. ESP32 is the first device implementation and
OpenClaw is the first agent adapter, but both public protocols remain independent
of those products.

## Deployable units

### Device implementation

Each device implementation owns its hardware, local audio behavior, state
machine, and Device Link v1. It exposes no OpenClaw or speech-provider concepts.

Primary responsibilities:

- ES8388 audio capture and playback
- push-to-talk and optional local WakeNet/VAD
- WSS connection, authentication, audio framing, and reconnect
- bounded capture/playback buffers
- display and physical-button interaction
- configuration, diagnostics, and signed OTA

### Relay

The Relay is the only turn orchestrator. It terminates public device and
Connector connections, sends audio to ASR, sends final transcripts through its
`AgentPort`, segments agent text for TTS, and streams audio to the device.

It does not know ACP message shapes, Gateway session keys, board GPIOs, or
OpenClaw credentials.

### Connector

The Connector runs beside one configured AgentRuntime and makes a long-lived
outbound WSS connection to Relay. The first adapter supervises a local
`openclaw acp` child process and maps logical conversations to locally authorized
OpenClaw sessions.

It does not process PCM audio, call speech providers, or expose arbitrary native
agent, HTTP, shell, or session operations to Relay.

Connector Link cannot choose an agent. Replacing OpenClaw is a Connector
deployment/configuration change that selects a different `AgentRuntimePort`
adapter. Exactly one adapter is active per Connector.

## Conversation flow

1. The device detects a button press or wake word and creates a turn.
2. It sends `turn.start` and streams PCM frames to the Relay.
3. Local VAD or push-to-talk completion sends `turn.input_end`.
4. Relay ASR emits a final transcript.
5. Relay sends a narrow `agent.run` command to the authorized Connector.
6. Connector maps the logical conversation to its configured AgentRuntime
   session and prompts it.
7. Connector filters native runtime updates into semantic agent events.
8. Relay segments monotonic text deltas and starts TTS before the whole answer is
   complete.
9. The device buffers and plays the returned PCM audio.
10. Completion, cancellation, or failure moves the turn to a terminal state.

## Trust boundaries

| Boundary                  | Trust statement                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Device to Relay           | Device token identifies one device; all input is untrusted and bounded             |
| Relay to Connector        | Connector accepts only typed agent commands for locally allowed sessions           |
| Connector to AgentRuntime | Native agent credentials and session IDs never cross into Relay                    |
| Relay to speech provider  | Provider sees audio/text required for ASR/TTS; no OpenClaw credential              |
| Voice to tools            | Voice is not strong authentication; sensitive operations require separate approval |

## Failure semantics

- A device disconnect cancels the active turn.
- A Connector disconnect before acceptance produces `connector_offline`.
- A Connector disconnect after acceptance produces `execution_unknown` and is
  never automatically replayed.
- Relay restart may fail the current turn in v1; the next turn recovers.
- Late events after cancellation are dropped.
- Queue overflow terminates the turn instead of growing memory without bound.

## Deliberate v1 limits

- One active turn per device connection
- Half-duplex audio
- PCM only
- Single-node Relay
- One configured AgentRuntime per Connector; no multi-agent routing
- No durable turn queue and no exactly-once tool execution claim

## Replacement and recovery model

Device implementations live under `devices/<platform>`. Board adapters are
nested under their platform, such as
`devices/esp32/boards/atk-dnesp32s3`. A new platform implements Device Link and
passes the same conformance suite without changing Relay or Connector.

Agent implementations live under
`apps/connector/src/adapters/agents/<agent>`. OpenClaw is the first directory.
A different agent replaces that adapter behind `AgentRuntimePort`; it does not
add simultaneous multi-agent routing.

This is adapter replaceability, not Relay scale-out. v1 deliberately supports a
single Relay process with in-memory active connections and turns. A Relay
restart may fail the current turn, but authenticated devices and Connectors can
reconnect and start the next turn without restoring process-local state. Running
multiple Relay instances, sticky routing, distributed connection ownership, and
durable turn recovery are outside the v1 contract.
