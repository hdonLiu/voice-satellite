# Voice Satellite

Voice Satellite is an independent, open-source protocol and reference system for
connecting voice-capable devices to a remotely hosted AI agent. ESP32-S3 is the
first device implementation.

The first supported agent is OpenClaw through its local ACP bridge. One
Connector activates one replaceable AgentRuntime. OpenClaw stays on the user's
computer: the Connector makes an outbound WebSocket connection to a cloud Relay,
so the OpenClaw Gateway and its credentials never need to be exposed publicly.

> This is an independent community project. It is not affiliated with or
> endorsed by OpenClaw, Espressif, ALIENTEK, or cc-connect.

[简体中文](README.zh-CN.md)

## Status

The complete v1 reference path is implemented: strict Device/Connector links,
single-node Relay, OpenAI speech adapters, outbound Connector, OpenClaw ACP
runtime, and ESP-IDF firmware for ATK-DNESP32S3. Automated tests cover schema
validation, binary audio, bounded queues, 100 turns, provider adapters, fake ACP,
and a real WebSocket device-to-agent-to-device loop. CI also performs clean PTT
and WakeNet firmware builds. Hardware smoke testing and deployment are still
required before a release; see the
[implementation status](docs/roadmap/implementation-status.md).

## Architecture

```text
ESP32-S3                         Cloud                       OpenClaw computer
┌──────────────────┐   WSS   ┌──────────────────┐   WSS   ┌──────────────────┐
│ wake/VAD/audio/UI├─────────►│ Voice Relay      ├─────────►│ Local Connector   │
│ Device Link v1   │◄─────────┤ ASR / TTS        │◄─────────┤ Connector Link v1 │
└──────────────────┘  PCM/ctl └──────────────────┘  events └────────┬─────────┘
                                                                    │ ACP/stdio
                                                           ┌────────▼─────────┐
                                                           │ openclaw acp     │
                                                           │ localhost Gateway│
                                                           └──────────────────┘
```

The system has three independently deployable units:

- **Device implementation** — local wake detection, VAD, audio capture/playback,
  UI, and a narrow Device Link protocol. ESP32 is the first reference device;
  implementations for other device platforms can use the same protocol.
- **Relay** — device authentication, streaming ASR/TTS, turn orchestration,
  backpressure, and Connector routing. It never receives OpenClaw credentials.
- **Connector** — an outbound-only client on the OpenClaw computer. It maps
  logical conversations to local ACP sessions and exposes only a narrow agent
  event surface to the Relay. A Connector activates exactly one AgentRuntime;
  OpenClaw is the first replaceable implementation.

See [Architecture Overview](docs/architecture/overview.md) and
[Module Boundaries](docs/architecture/module-boundaries.md). The implementation
contracts are in the [Detailed Design](docs/design/detailed-design.zh-CN.md).

## v1 reference scope

- ATK-DNESP32S3 with ES8388 audio codec
- ESP-IDF firmware with push-to-talk and optional ESP-SR WakeNet/VAD profiles
- Half-duplex PCM audio over authenticated WSS
- Single-node TypeScript Relay with pluggable streaming ASR and TTS providers
- TypeScript Connector using `openclaw acp` over local stdio
- Streaming text-to-speech, cancellation, status display, and physical approval
- Protocol validators, fake components, and conformance-style integration tests

See the [Implementation Plan](docs/roadmap/implementation-plan.md) and the
[task-level execution plan](docs/roadmap/execution-plan.zh-CN.md).

## Design principles

1. OpenClaw credentials stay on the OpenClaw computer.
2. ACP is a local Connector implementation detail, never a cloud or MCU protocol.
3. Wire messages are versioned and strongly validated at adapter boundaries.
4. Core modules exchange semantic events, not vendor responses or raw ACP frames.
5. Every queue is bounded; uncertain agent operations are never replayed blindly.
6. Device implementations are interchangeable behind Device Link v1.
7. A Connector runs one replaceable AgentRuntime; Relay never selects an agent.
8. Push-to-talk remains available without ESP-SR or proprietary wake-word models.
9. The project is an independent implementation, not a cc-connect fork or clone.

Replaceability does not imply Relay scale-out: v1 runs one Relay process with
in-memory active-turn state and recovers at the next turn after a restart.

## Repository layout

```text
apps/relay/             Cloud Relay application
apps/connector/         Outbound local Connector
  src/adapters/agents/
    openclaw/            First AgentRuntime adapter
devices/
  esp32/                 First Device Link reference implementation
    boards/
      atk-dnesp32s3/     First ESP32 board adapter
packages/contracts/     Versioned wire schemas and generated DTOs
packages/testkit/       Fake devices/providers/agents
specs/                  Protocol specifications
conformance/            Golden traces and compatibility tests
deploy/                 Deployment and service templates
docs/                   Architecture, ADRs, roadmap, security, and licensing
```

## Contributing

Contributions to adapters, protocol fixtures, hardware validation, and threat
analysis are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## License

Original project code and documentation are licensed under Apache-2.0. Some
optional firmware dependencies, notably ESP-SR/WakeNet, have separate terms and
must not be relicensed as Apache-2.0. See [Licensing](docs/licensing.md) and
[Third-Party Notices](THIRD_PARTY_NOTICES.md).
