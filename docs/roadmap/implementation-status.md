# Implementation status

- Updated: 2026-08-13
- Stage: v1 implementation complete; deployment and hardware qualification pending

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
  24-to-16 kHz capture conversion, bounded playback, PTT, optional WakeNet,
  energy endpointing, NVS config, TLS verification, and physical approval
- clean ESP-IDF 5.5.2 CI builds for both the dependency-light PTT profile and
  the ESP-SR WakeNet profile
- deterministic fake speech/agent/device components and tests covering 100 turns,
  cancellation, permission denial, provider HTTP contracts, fake ACP, persistence,
  and a real WebSocket audio-to-audio network loop

## Pending deployment, qualification, and release decisions

- flash and qualify the physical ATK board (codec gain, acoustic thresholds,
  WakeNet model selection, long-run DMA and Wi-Fi stability)
- provide actual domain/TLS termination, credentials, OpenAI account settings,
  and service managers on the chosen hosts
- perform real OpenClaw, ASR/TTS, latency, reconnect, and 50-turn acceptance runs
- choose and implement the release/OTA signing and distribution policy

No credentials or deployment decisions are committed to the repository. The
firmware is never flashed automatically.
