# ATK-DNESP32S3 board adapter

This is the first ESP32 board adapter and targets ATK-DNESP32S3 with ES8388.

The adapter will own only board-specific details:

- GPIO and peripheral assignments
- ES8388 and amplifier wiring/power sequence
- display and key wiring
- board-specific `sdkconfig` defaults
- hardware self-test hooks

Audio/session state, Device Link, WSS, credentials, storage, diagnostics, and OTA
remain in shared `devices/esp32` modules.

Pin assignments will be independently documented from authoritative schematics
during P0 before implementation starts.
