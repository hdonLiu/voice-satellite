# Voice Satellite

Voice Satellite is an independent, open-source voice terminal for connecting
ESP32-S3 hardware to a remotely hosted AI agent.

The first supported agent is OpenClaw through its local ACP bridge. OpenClaw
stays on the user's computer: a small Connector makes an outbound WebSocket
connection to a cloud Relay, so the OpenClaw Gateway and its credentials never
need to be exposed to the public internet.

> This is an independent community project. It is not affiliated with or
> endorsed by OpenClaw, Espressif, ALIENTEK, or cc-connect.

[简体中文](README.zh-CN.md)

## Status

The project is in its architecture and protocol-definition phase. There is no
usable firmware or server release yet. The implementation will proceed through
hardware and ACP compatibility spikes before the v1 protocols are frozen.

## Architecture

```text
ESP32-S3                         Cloud                       OpenClaw computer
┌──────────────────┐   WSS   ┌──────────────────┐   WSS   ┌──────────────────┐
│ wake/VAD/audio/UI├─────────►│ Voice Relay      ├─────────►│ Local Connector   │
│ Device Link v1   │◄─────────┤ ASR / TTS        │◄─────────┤ Agent Link v1     │
└──────────────────┘  PCM/ctl └──────────────────┘  events └────────┬─────────┘
                                                                    │ ACP/stdio
                                                           ┌────────▼─────────┐
                                                           │ openclaw acp     │
                                                           │ localhost Gateway│
                                                           └──────────────────┘
```

The system has three independently deployable units:

- **Firmware** — local wake detection, VAD, audio capture/playback, UI, and a
  narrow Device Link protocol. It knows nothing about OpenClaw or speech-cloud
  vendors.
- **Relay** — device authentication, streaming ASR/TTS, turn orchestration,
  backpressure, and Connector routing. It never receives OpenClaw credentials.
- **Connector** — an outbound-only client on the OpenClaw computer. It maps
  logical conversations to local ACP sessions and exposes only a narrow agent
  event surface to the Relay.

See [Architecture Overview](docs/architecture/overview.md) and
[Module Boundaries](docs/architecture/module-boundaries.md).

## Planned v1 scope

- ATK-DNESP32S3 with ES8388 audio codec
- ESP-IDF firmware with push-to-talk and optional ESP-SR WakeNet/VAD profiles
- Half-duplex PCM audio over authenticated WSS
- Single-node TypeScript Relay with pluggable streaming ASR and TTS providers
- TypeScript Connector using `openclaw acp` over local stdio
- Streaming text-to-speech, cancellation, status display, and physical approval
- Signed firmware OTA with rollback
- Protocol fixtures, fake components, conformance tests, SBOMs, and signed releases

See the [Implementation Plan](docs/roadmap/implementation-plan.md).

## Design principles

1. OpenClaw credentials stay on the OpenClaw computer.
2. ACP is a local Connector implementation detail, never a cloud or MCU protocol.
3. Wire messages are versioned and strongly validated at adapter boundaries.
4. Core modules exchange semantic events, not vendor responses or raw ACP frames.
5. Every queue is bounded; uncertain agent operations are never replayed blindly.
6. Push-to-talk remains available without ESP-SR or proprietary wake-word models.
7. The project is an independent implementation, not a cc-connect fork or clone.

## Repository layout

```text
apps/relay/             Cloud Relay application
apps/connector/         Outbound local Connector
firmware/               ESP32-S3 firmware
packages/contracts/     Versioned wire schemas and generated DTOs
packages/testkit/       Fake devices/providers/agents
specs/                  Protocol specifications
conformance/            Golden traces and compatibility tests
deploy/                 Deployment and service templates
docs/                   Architecture, ADRs, roadmap, security, and licensing
```

## Contributing

The implementation has not started. Contributions to architecture, protocol
fixtures, hardware validation, and threat analysis are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## License

Original project code and documentation are licensed under Apache-2.0. Some
optional firmware dependencies, notably ESP-SR/WakeNet, have separate terms and
must not be relicensed as Apache-2.0. See [Licensing](docs/licensing.md) and
[Third-Party Notices](THIRD_PARTY_NOTICES.md).
