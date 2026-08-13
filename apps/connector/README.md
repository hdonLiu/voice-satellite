# Connector application

The Connector runs on the OpenClaw computer, makes one outbound WSS connection
to Relay, and supervises a local `openclaw acp` process.

Planned internal layout:

```text
src/
  domain/
  application/
  ports/
  adapters/relay-ws/
  adapters/openclaw-acp/
  bootstrap/
```

It never processes PCM, ASR, TTS, VAD, or ESP32 hardware. It is not a general
ACP, HTTP, shell, filesystem, or session proxy.
