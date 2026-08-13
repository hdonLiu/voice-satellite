# Relay application

The Relay terminates Device Link and Connector Link WebSocket connections, runs
the speech pipeline, and owns the turn lifecycle. TLS is expected to terminate
at a deployment-controlled reverse proxy; the process itself exposes HTTP/WS.

Implemented layout:

```text
src/
  application/
  ports/
  adapters/device-ws/
  adapters/connector-ws/
  adapters/speech/openai/
  server/
  main.ts
```

The Relay must not contain ACP JSON-RPC, Gateway session keys, OpenClaw
credentials, board GPIOs, or codec-specific behavior.

`AgentPort` is the only Relay application boundary toward Connector. The WSS
adapter implements that port by speaking Connector Link.

After `pnpm build`, start with:

```bash
OPENAI_API_KEY=... \
VS_RELAY_DEVICE_TOKENS='{"my-device":"device-secret"}' \
VS_RELAY_CONNECTOR_TOKEN='connector-secret' \
pnpm --filter @voice-satellite/relay start
```

Optional settings include `VS_RELAY_HOST`, `VS_RELAY_PORT`, `OPENAI_BASE_URL`,
`OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TRANSCRIBE_LANGUAGE`, `OPENAI_TTS_MODEL`, and
`OPENAI_TTS_VOICE`. `/healthz` reports process and Connector readiness. Never put
an OpenClaw Gateway credential in Relay configuration.
