# ADR 0003: Initial technology baseline

- Status: Proposed, pending P0 compatibility spikes
- Date: 2026-08-13

## Proposed baseline

- Firmware: C++ and a pinned stable ESP-IDF release
- Codec: `esp_codec_dev` for ES8388
- Optional wake/VAD: pinned ESP-SR component
- Relay and Connector: TypeScript strict mode on Node.js 24 LTS
- Workspace: pnpm
- Transport: authenticated WSS
- Boundary validation: JSON Schema with runtime TypeScript validation
- Internal streams: `AsyncIterable`, `AbortController`, bounded queues
- Agent adapter: official ACP TypeScript SDK when compatible
- Audio: PCM16, 16 kHz mono input and 24 kHz mono output

## Why TypeScript

OpenClaw already requires Node.js, ACP has an official TypeScript SDK, and Relay
and Connector can share protocol DTO generation and conformance fixtures. Go
remains an option for a later Relay rewrite because wire protocols are language
neutral.

## Compatibility gate

No version is final until P0 verifies the actual board, ESP-SR, ES8388, OpenClaw
ACP version, and selected streaming ASR/TTS behavior.
