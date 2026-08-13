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

The device sends `device.hello` with its protocol version, physical-approval
support, and optional diagnostics. Relay responds with `device.welcome` or
closes with a stable authentication/version error.

The initial `device.hello` uses `seq = 0` and omits `connectionId`. Relay assigns
`connectionId` in `device.welcome`; every later message must carry it and use a
strictly increasing connection-local control sequence.

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

Required base fields are `v`, `type`, `seq`, and `payload`. `connectionId` is
required after the hello/welcome exchange. Turn messages additionally require
`conversationId` and `turnId`.

Unknown fields, unknown message types, invalid required fields, and unsupported
major versions are rejected.

## Device to Relay messages

| Type                 | Purpose                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `device.hello`       | Validate the protocol and report physical-approval support plus diagnostics |
| `turn.start`         | Start one voice turn                                                        |
| `turn.input_end`     | No more microphone audio will be sent                                       |
| `turn.cancel`        | Cancel capture, agent work, TTS, and playback                               |
| `permission.resolve` | Resolve a currently valid physical approval request                         |
| `pong`               | Heartbeat response                                                          |

## Relay to Device messages

| Type                 | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `device.welcome`     | Accept negotiation and report Connector status  |
| `turn.accepted`      | Relay accepted the turn                         |
| `turn.state`         | Stable state for UI presentation                |
| `transcript.final`   | Final user transcript                           |
| `audio.start`        | Declare output format and begin playback stream |
| `audio.end`          | End playback stream                             |
| `permission.request` | Request a physical allow/deny decision          |
| `turn.done`          | Terminal successful or cancelled result         |
| `turn.error`         | Terminal stable error                           |
| `ping`               | Heartbeat request                               |

## Audio formats

v1 baseline:

- input: signed PCM16 little-endian, 16 kHz, mono, 20 ms per payload
- output: signed PCM16 little-endian, 24 kHz, mono

Opus and alternative rates require a future protocol revision and are not part
of the v1 contract.

## Device hello payload

v1 does not negotiate a device capability or audio-format matrix. Every
conforming device supports the baseline input and output formats above.
`device.hello` has one behavior field that changes a Relay decision:

```text
physicalApproval: true | false
diagnostics?: platform / board / softwareVersion / buildProfile
```

Without physical approval, permission requests are denied. Diagnostics are
optional and never affect routing or turn behavior.

Wake detection, VAD, display, buttons, OTA, and the push-to-talk/WakeNet build
profile are local implementation details. Both input profiles produce the same
`turn.start` → audio → `turn.input_end` wire behavior. v1 is half-duplex and has
no barge-in capability. Relay must not branch on diagnostics.

## Binary audio header

All integers use network byte order. The fixed header is 40 bytes:

| Offset | Size | Field                                      |
| -----: | ---: | ------------------------------------------ |
|      0 |    4 | ASCII magic `VSA1`                         |
|      4 |    1 | protocol version `1`                       |
|      5 |    1 | direction: `0` input, `1` output           |
|      6 |    2 | flags/reserved, must be zero               |
|      8 |    4 | monotonic `uint32` audio sequence          |
|     12 |    8 | sender timestamp in milliseconds, `uint64` |
|     20 |   16 | UUID bytes for `audioStreamId`             |
|     36 |    4 | payload length, maximum 64 KiB             |

The payload immediately follows the header. Its byte count must exactly equal
the declared length; trailing and truncated frames are rejected.

Because WSS/TCP is ordered and reliable, audio is not acknowledged or replayed
at application level. Sequence numbers detect gaps and aid diagnostics.

## Turn rules

- `turn.start` is invalid while another turn is active.
- audio may immediately follow `turn.start`; Relay establishes the active Turn
  before it emits `turn.accepted`. Audio is invalid after `turn.input_end`.
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
timeout
cancelled
backpressure
execution_unknown
internal
```
