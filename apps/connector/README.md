# Connector application

The Connector runs beside one configured agent and makes one outbound WSS
connection to Relay. OpenClaw is the first AgentRuntime implementation.

Planned internal layout:

```text
src/
  domain/
  application/
  ports/
    agent-runtime.ts
  adapters/relay-ws/
  adapters/agents/
    openclaw/
  bootstrap/
```

It never processes PCM, ASR, TTS, VAD, or ESP32 hardware. It is not a general
ACP, HTTP, shell, filesystem, or session proxy.

Each Connector activates exactly one adapter under `adapters/agents/`. Replacing
OpenClaw means selecting another implementation of `AgentRuntimePort`; there is
no multi-agent registry or remote agent selection in the protocol.
