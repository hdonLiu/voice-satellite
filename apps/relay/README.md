# Relay application

The Relay will terminate Device Link and Connector Link WSS connections, run the
streaming speech pipeline, and own the turn lifecycle.

Planned internal layout:

```text
src/
  domain/
  application/
  ports/
  adapters/device-ws/
  adapters/connector-ws/
  adapters/asr/
  adapters/tts/
  bootstrap/
```

The Relay must not contain ACP JSON-RPC, Gateway session keys, OpenClaw
credentials, board GPIOs, or codec-specific behavior.
