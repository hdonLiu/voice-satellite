# Implementation status

- Updated: 2026-08-18
- Stage: device-to-cloud transcription path verified; Agent integration pending

This file records implemented behavior, not planned behavior. Task definitions
and exit gates remain in the
[task-level execution plan](execution-plan.zh-CN.md).

## Implemented

- strict TypeScript workspace, pinned dependencies, formatting, docs checks,
  build, tests, and CI
- complete Device Link and Connector Link v1 runtime validators
- frozen `VSA1` binary PCM audio header with TypeScript and ESP-IDF codecs
- authenticated Device and Connector WebSocket ingress with separate tokens,
  strict sequences, size limits, single Connector routing, and fail-closed input
- in-memory, single-node Turn orchestration with bounded queues, cancellation,
  deadlines, monotonic segmentation, and `execution_unknown` on accepted-request
  disconnects
- OpenAI buffered transcription adapter and streaming raw-PCM TTS adapter behind
  replaceable speech ports
- outbound-only Connector with reconnect, one `AgentRuntimePort`, bounded request
  dedupe, and atomic `0600` session-binding storage
- OpenClaw adapter using the official ACP TypeScript SDK and supervised
  `openclaw acp` stdio, including session mapping, deltas, cancellation, filtered
  status, physical permissions, bounded ACP lines, and child shutdown
- ESP-IDF firmware organized behind a board port, with ATK-DNESP32S3 ES8388,
  ST7789/LVGL transcript display, 24-to-16 kHz capture conversion, bounded
  playback, PTT, optional WakeNet, Relay-side WakeNet endpointing, NVS config, Wi-Fi,
  verified TLS/WSS, reconnect, and physical approval
- a strongly typed `TranscriptSinkPort` that receives the recognized text with
  its device, conversation, and turn identifiers, independently of the future
  Agent adapter
- clean ESP-IDF 5.5.2 CI builds for both the dependency-light PTT profile and
  the ESP-SR WakeNet profile
- deterministic fake speech/agent/device components and tests covering 100 turns,
  cancellation, permission denial, provider HTTP contracts, fake ACP, persistence,
  and a real WebSocket audio-to-audio network loop

## Verified deployment and hardware path

- Relay deployed on a TencentOS CVM behind HTTPS/WSS termination, in
  transcription-only mode with self-hosted whisper.cpp ASR
- public health check and an authenticated, synthetic PCM-over-WSS Chinese ASR
  turn completed successfully
- physical ATK-DNESP32S3 boots with its retained NVS provisioning, initializes
  the ST7789 display and ES8388 codec, joins Wi-Fi, validates the public server
  certificate, and completes the Device Link handshake
- two real board-microphone turns completed through
  `ESP32 -> WSS -> Relay -> ASR -> transcript.final -> ESP32 display path`, and
  both results were published to the transcript sink; Relay production logs
  record metadata and character counts without recording transcript bodies
- the current full-CJK voice UI/PTT build was flashed to the physical board;
  its automated room-playback turn delivered 8.3 seconds of microphone audio
  to whisper.cpp, returned a non-empty Chinese transcript to the display, and
  completed without saturating the device upload queue
- the firmware stores the bounded maximum capture window in PSRAM while
  retaining an internal DMA reserve; both PTT and WakeNet profiles pass CI

- Relay-side WakeNet endpointing is deployed from commit `a8001c1`; an
  authenticated public WSS smoke turn received `turn.input_stop(no_speech)`
  followed by the single terminal `turn.error(cancelled)`. The updated WakeNet
  firmware builds in CI but is not yet included in the physical-turn evidence
  above.

## Pending qualification and later integration

- tune microphone acoustics/codec gain and qualify recognition accuracy with a
  human speaker; the automated room-capture test proved routing but produced
  low-quality recognition text
- flash the updated WakeNet image and qualify speech-end, no-speech, maximum
  duration, and second-wake cancellation on the physical board
- qualify WakeNet model selection, long-run DMA/Wi-Fi stability, reconnect,
  latency, and 50-turn acceptance
- connect the replaceable Agent/Connector path to the separately hosted
  OpenClaw installation; this is intentionally outside the current
  device-to-cloud milestone
- select a production domain and certificate rather than retaining IP-address
  TLS as the long-term endpoint
- perform real TTS/playback acceptance after the Agent path is enabled
- choose and implement the release/OTA signing and distribution policy

No credentials are committed to the repository. Physical flashing and
provisioning remain explicit operator actions; CI only builds and validates the
firmware artifacts.
