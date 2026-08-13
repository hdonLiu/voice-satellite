# Implementation status

- Updated: 2026-08-13
- Stage: provisional P1/P2 core implementation; P0 compatibility gates remain open

This file records implemented behavior, not planned behavior. Task definitions
and exit gates remain in the
[task-level execution plan](execution-plan.zh-CN.md).

## Implemented

- pnpm workspace with pinned Node tooling, strict TypeScript, formatting,
  Markdown checks, tests, builds, and GitHub Actions CI
- branded public IDs, fixed PCM contracts, stable v1 errors, turn phases, and
  TypeBox runtime validation for the first Device/Connector messages
- minimal Device hello schema with `physicalApproval` as its only behavioral
  field; platform, board, version, and build profile are diagnostics
- Relay speech, agent, and device-output ports
- in-memory `TurnRegistry`, idempotent terminal path, bounded async queue, and
  monotonic sentence segmenter
- streaming Turn orchestration from audio input through ASR, Agent, TTS, and
  device output
- Connector `AgentRuntimePort`, `SingleRuntimeHost`, session binding port,
  bounded request dedupe, event projection, cancellation, and permission bridge
- deterministic Fake ASR, TTS, AgentRuntime, session store, audio input, and
  recording device output
- all-Fake audio-to-audio tests, including 100 sequential turns, cancellation,
  structured permission denial, and async-generator cleanup regression coverage

## Not implemented yet

- Device Link and Connector Link WebSocket gateways and complete message schemas
- durable Connector session-binding storage
- OpenClaw ACP child-process adapter
- real streaming ASR/TTS provider adapters
- ESP-IDF firmware and ATK-DNESP32S3 board adapter
- deployment images, credential provisioning, OTA, and production hardening

No current artifact is a usable voice-device release.

The implemented core is intentionally still allowed to change. Device/Connector
wire schemas, audio framing, and real adapter contracts are not frozen until the
P0 hardware, ACP, and speech-provider evidence is complete.
