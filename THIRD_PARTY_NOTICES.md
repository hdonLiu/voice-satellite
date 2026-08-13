# Third-party notices

This file is the project-level inventory. Every release must also include an
exact SPDX SBOM derived from the resolved firmware and Node.js dependency locks.

| Component                     | Purpose                    | Expected license                                  | Distribution policy                                    |
| ----------------------------- | -------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| ESP-IDF                       | ESP32-S3 framework         | Apache-2.0 plus component-specific licenses       | Pin exact release; include generated SBOM              |
| esp_codec_dev                 | ES8388 codec support       | Apache-2.0                                        | Resolve through ESP Component Manager                  |
| esp_websocket_client          | Device WSS transport       | Apache-2.0                                        | Resolve through ESP Component Manager                  |
| ESP-SR / WakeNet              | Optional wake detection    | Espressif-modified MIT, Espressif products only   | WakeNet profile only; preserve full separate terms     |
| Agent Client Protocol SDK 1.3 | Local ACP integration      | Apache-2.0                                        | Exact Node lock; retain notices                        |
| TypeBox                       | Runtime wire validation    | MIT                                               | Exact Node lock                                        |
| ws                            | Relay/Connector WebSockets | MIT                                               | Exact Node lock                                        |
| OpenClaw                      | User-installed agent       | MIT                                               | Not bundled; invoked locally through `openclaw acp`    |

The repository does not redistribute cc-connect source code, protocol assets,
documentation, icons, configuration, or tests.

This inventory must be updated when the implementation introduces actual
dependencies. A dependency appearing here is not yet proof that it is included
in a release artifact.
