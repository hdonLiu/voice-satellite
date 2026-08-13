# Licensing

## Project license

Original source code and documentation are Apache-2.0. Original source files
should carry:

```text
SPDX-License-Identifier: Apache-2.0
```

## ESP-IDF and firmware components

ESP-IDF is primarily Apache-2.0 but contains components under other compatible
terms. Release artifacts must use the resolved dependency lock and
`esp-idf-sbom` to produce an exact SPDX inventory.

ESP-SR uses an Espressif-modified MIT-style license that grants free use on
Espressif products. It is not standard MIT and must not be relicensed as
Apache-2.0. WakeNet-enabled releases must preserve those terms and identify the
hardware-use restriction.

The project therefore keeps ESP-SR optional and provides a push-to-talk firmware
profile that does not link it.

## OpenClaw and ACP

OpenClaw is installed separately by the user and is not bundled with Connector
artifacts. The Connector invokes the public `openclaw acp` interface.

ACP schemas and official SDKs are Apache-2.0. Any copied schema or generated code
must retain required notices and record the exact source version.

## Release requirements

Every release must include:

- `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`
- resolved dependency locks
- SPDX SBOMs for firmware and Node.js artifacts
- checksums and release signatures
- a review that the PTT profile does not link ESP-SR

This document is engineering guidance, not legal advice.
