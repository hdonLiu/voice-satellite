# Device Link v1

- Status: Draft
- Transport: WebSocket over TLS
- Control frames: UTF-8 JSON text frames
- Audio frames: binary frames

This specification defines the public boundary between firmware and Relay. It
does not expose OpenClaw, ACP, or speech-provider concepts.

## Connection

The device opens one authenticated WSS connection. A device credential is sent
in the HTTP `Authorization` header, never in the URL. TLS certificate validation
and SNI are mandatory.

The device sends `device.hello` with protocol and capability information. Relay
responds with `device.welcome` or closes with a stable authentication/version
error.

v1 allows one active turn and one active audio stream per connection.

`DeviceId` is an issued logical identity. It must not be defined as a MAC
address, chip ID, board model, GPIO layout, or operating system. Platform, board,
and firmware version may be reported as diagnostic metadata but never become
domain routing keys.

## Control envelope

```json
{
  "v": 1,
  "type": "turn.start",
  "connectionId": "opaque-connection-id",
  "seq": 42,
  "conversationId": "opaque-conversation-id",
  "turnId": "opaque-turn-id",
  "payload": {}
}
```

Required base fields are `v`, `type`, `connectionId`, `seq`, and `payload`.
Turn messages additionally require `conversationId` and `turnId`.

Unknown optional fields are ignored. Unknown message types, invalid required
fields, and unsupported major versions are rejected.

## Device to Relay messages

| Type | Purpose |
|---|---|
| `device.hello` | Negotiate protocol, audio, display, button, and wake capabilities |
| `turn.start` | Start one voice turn |
| `turn.input_end` | No more microphone audio will be sent |
| `turn.cancel` | Cancel capture, agent work, TTS, and playback |
| `permission.resolve` | Resolve a currently valid physical approval request |
| `pong` | Heartbeat response |

## Relay to Device messages

| Type | Purpose |
|---|---|
| `device.welcome` | Accept negotiation and report Connector status |
| `turn.accepted` | Relay accepted the turn |
| `turn.state` | Stable state for UI presentation |
| `transcript.partial` | Optional ASR preview |
| `transcript.final` | Final user transcript |
| `audio.start` | Declare output format and begin playback stream |
| `audio.end` | End playback stream |
| `permission.request` | Request a physical allow/deny decision |
| `turn.done` | Terminal successful or cancelled result |
| `turn.error` | Terminal stable error |
| `ping` | Heartbeat request |

## Audio formats

v1 baseline:

- input: signed PCM16 little-endian, 16 kHz, mono, 20 ms per payload
- output: signed PCM16 little-endian, 24 kHz, mono

Opus and alternative rates require a future negotiated capability and are not
part of the v1 baseline.

## Device capabilities

`device.hello` describes supported input/output formats and optional features.
The P1 schema must represent at least:

```text
audio.input.formats
audio.output.formats
features.wakeWord
features.vad
features.display
features.buttons
features.permissionApproval
features.ota
features.bargeIn
```

Relay selects only mutually supported behavior. Missing display, wake, approval,
or output capability must produce explicit degradation rather than platform-name
checks in the turn orchestrator.

## Binary audio header

The exact byte layout is frozen after the P0 hardware and provider spikes. It
must include:

- protocol version
- direction
- audio stream identifier
- monotonic audio sequence
- sender timestamp
- flags
- payload length

Because WSS/TCP is ordered and reliable, audio is not acknowledged or replayed
at application level. Sequence numbers detect gaps and aid diagnostics.

## Turn rules

- `turn.start` is invalid while another turn is active.
- audio is valid only after `turn.accepted` and before `turn.input_end`.
- disconnect cancels the current turn.
- a cancelled or terminal turn ignores late audio and control events.
- reconnection creates a new connection and never resumes an old audio stream.
- all queues and message sizes are bounded by Relay policy.

## Stable errors

Initial stable error codes:

```text
unsupported_version
unauthorized
invalid_message
invalid_state
busy
connector_offline
speech_unavailable
agent_unavailable
approval_required
timeout
cancelled
backpressure
execution_unknown
internal
```
