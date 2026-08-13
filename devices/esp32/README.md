# ESP32 device implementation

ESP32 is the first Device Link reference implementation. Its first board target
is ATK-DNESP32S3 with ES8388. Firmware is an independent ESP-IDF project and
does not include XiaoZhi networking, protocol, or agent code.

Board-specific details live under `boards/<board>`. Shared ESP32 state, protocol,
audio, transport, storage, and OTA code must not depend on a concrete board.

Planned profiles:

- `ptt` — push-to-talk without ESP-SR
- `wakenet` — optional ESP-SR WakeNet/VAD on Espressif hardware
- `headless` — no display dependency

Planned components:

```text
vs_domain
vs_board
vs_audio
vs_wake
vs_protocol
vs_transport
vs_ui
vs_storage
vs_ota
vs_diag
```

The existing device's original flash backup is deliberately not stored in this
repository. Hardware flashing begins only after the P0 audio and recovery gate.
