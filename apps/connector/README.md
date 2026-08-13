# Connector application

The Connector runs beside one configured agent and makes one outbound WSS
connection to Relay. OpenClaw is the first AgentRuntime implementation.

Implemented layout:

```text
src/
  application/
  ports/
    agent-runtime.ts
  transport/ws-relay-client.ts
  adapters/agents/
    openclaw/
  infrastructure/json-file-session-store.ts
  main.ts
```

It never processes PCM, ASR, TTS, VAD, or ESP32 hardware. It is not a general
ACP, HTTP, shell, filesystem, or session proxy.

Each Connector activates exactly one adapter under `adapters/agents/`. Replacing
OpenClaw means selecting another implementation of `AgentRuntimePort`; there is
no multi-agent registry or remote agent selection in the protocol.

After `pnpm build`, run this on the computer where `openclaw acp` works:

```bash
VS_RELAY_URL=wss://relay.example/v1/connector \
VS_RELAY_CONNECTOR_TOKEN='connector-secret' \
OPENCLAW_WORKDIR="$PWD" \
pnpm --filter @voice-satellite/connector start
```

`OPENCLAW_EXECUTABLE`, `OPENCLAW_ACP_ARGS`, and `VS_CONNECTOR_STATE_FILE` are
optional. The session store is atomically written with mode `0600`. The Relay
token authenticates only the narrow Connector Link; OpenClaw/Gateway credentials
remain inside the local OpenClaw process.

Run `pnpm --filter @voice-satellite/connector doctor` first to validate the URL,
state directory, and local OpenClaw executable without opening a Relay session.
