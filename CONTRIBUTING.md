# Contributing

Voice Satellite welcomes focused contributions to protocols, firmware, Relay,
Connector, adapters, tests, and documentation.

## Before contributing

1. Read the architecture and module-boundary documents.
2. Open an issue or discussion for wire-protocol or security-boundary changes.
3. Keep dependency direction as `adapters -> ports/application -> domain`.
4. Do not introduce OpenClaw, ACP, or speech-provider details into firmware.
5. Do not introduce PCM, VAD, or ESP32 details into the Connector.

## Independent implementation rule

cc-connect helped validate the general idea of an outbound Connector and clear
platform/engine/agent boundaries. This repository does not copy or implement its
source, protocol fields, configuration format, tests, documentation, UI, icons,
or assets. Contributions must not introduce code or assets from cc-connect or
another project unless their source and compatible license are clearly recorded.

## Contribution terms

Contributions are licensed under Apache-2.0. Add a `Signed-off-by` line to each
commit to certify the Developer Certificate of Origin 1.1:

```bash
git commit -s -m "Describe the change"
```

By submitting a contribution, you confirm that you have the right to submit it,
that third-party material is identified, and that generated code records its
generator and source schema.

## Change requirements

- Core and protocol changes require tests.
- Wire-protocol changes require updated schemas and golden traces.
- Adapter changes require contract tests against the relevant port.
- Dependency changes require license and vulnerability review.
- Firmware release changes require an updated SBOM.
- Never commit tokens, private endpoints, raw user audio, or transcripts.

Formatting, build, test, and release commands will be added when the code
workspace is initialized in implementation phase P1.
