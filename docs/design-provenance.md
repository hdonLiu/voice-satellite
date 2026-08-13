# Design provenance

Voice Satellite is an independent implementation.

## References

The project reviewed publicly documented and publicly observable patterns in
several ecosystems:

- OpenClaw's official ACP bridge and Gateway documentation
- the Agent Client Protocol specification and SDKs
- Espressif's ESP-IDF, ESP Codec Dev, and ESP-SR documentation
- ALIENTEK hardware documentation
- cc-connect as an example of an outbound connector with separated platform,
  orchestration, and agent/session concepts

## Independent implementation boundary

The project does not copy or implement cc-connect source code, protocol fields,
configuration format, command names, tests, documentation wording, UI, icons, or
assets. It defines two independent voice-specific protocols and uses official
ACP specifications and SDKs for the OpenClaw adapter.

Because maintainers have reviewed publicly available cc-connect implementation
details, this work is described as an independent implementation rather than a
formal clean-room implementation.

Contributors must record the source and license of incorporated or adapted
third-party material. Unclear provenance is grounds for rejecting a change.
