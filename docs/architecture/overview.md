# Architecture overview

## Goal

Voice Satellite turns a small ESP32-S3 device into a voice interface for an AI
agent running on another computer. The first agent adapter targets OpenClaw, but
the device and Relay protocols remain agent-neutral.

## Deployable units

### Firmware

The firmware owns board hardware, local audio behavior, the device state machine,
and Device Link v1. It exposes no OpenClaw or speech-provider concepts.

Primary responsibilities:

- ES8388 audio capture and playback
- push-to-talk and optional local WakeNet/VAD
- WSS connection, authentication, audio framing, and reconnect
- bounded capture/playback buffers
- display and physical-button interaction
- configuration, diagnostics, and signed OTA

### Relay

The Relay is the only turn orchestrator. It terminates public device and
Connector connections, sends audio to ASR, sends final transcripts to the
Connector, segments agent text for TTS, and streams audio to the device.

It does not know ACP message shapes, Gateway session keys, board GPIOs, or
OpenClaw credentials.

### Connector

The Connector runs beside OpenClaw. It makes a long-lived outbound WSS
connection to the Relay and supervises a local `openclaw acp` child process. It
maps public logical conversation IDs to locally authorized OpenClaw sessions.

It does not process PCM audio, call speech providers, or expose arbitrary ACP,
HTTP, shell, or Gateway operations to the Relay.

## Conversation flow

1. The device detects a button press or wake word and creates a turn.
2. It sends `turn.start` and streams PCM frames to the Relay.
3. Local VAD or push-to-talk completion sends `turn.input_end`.
4. Relay ASR emits a final transcript.
5. Relay sends a narrow `agent.run` command to the authorized Connector.
6. Connector maps the logical conversation to a local ACP session and prompts
   `openclaw acp`.
7. Connector filters ACP updates into semantic agent events.
8. Relay segments monotonic text deltas and starts TTS before the whole answer is
   complete.
9. The device buffers and plays the returned PCM audio.
10. Completion, cancellation, or failure moves the turn to a terminal state.

## Trust boundaries

| Boundary | Trust statement |
|---|---|
| Device to Relay | Device token identifies one device; all input is untrusted and bounded |
| Relay to Connector | Connector accepts only typed agent commands for locally allowed sessions |
| Connector to ACP | Local stdio only; ACP/Gateway credentials never cross into Relay |
| Relay to speech provider | Provider sees audio/text required for ASR/TTS; no OpenClaw credential |
| Voice to tools | Voice is not strong authentication; sensitive operations require separate approval |

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
- One configured Connector and OpenClaw voice agent per installation
- No durable turn queue and no exactly-once tool execution claim
