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
  adapters/agent-port-ws/
  adapters/asr/
  adapters/tts/
  bootstrap/
```

The Relay must not contain ACP JSON-RPC, Gateway session keys, OpenClaw
credentials, board GPIOs, or codec-specific behavior.

`AgentPort` is the only Relay application boundary toward Connector. The WSS
adapter implements that port by speaking Connector Link.
