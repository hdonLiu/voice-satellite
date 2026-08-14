# Cloud Relay deployment

This directory deploys the single-node Relay behind Caddy. Caddy obtains a
publicly trusted certificate and proxies both HTTPS and WebSocket upgrades. The
OpenClaw Gateway is never deployed or exposed here: it stays on the Connector
computer, which makes an outbound WSS connection to this Relay.

## Prerequisites

- one Linux VPS with Docker Engine and the Compose plugin
- public TCP ports 80 and 443, plus optional UDP 443 for HTTP/3
- a DNS `A`/`AAAA` record pointing the chosen domain to that VPS
- an OpenAI API key, or a compatible speech provider base URL and credentials

## Configure

From the repository root on the VPS:

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

Edit `deploy/.env`. Generate independent Device and Connector tokens instead of
reusing a password:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

`VS_RELAY_DEVICE_TOKENS` is a JSON object. Keep the `link-probe` credential for
pre-hardware tests, then add a separately generated ESP32 credential later.

## Start

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

Verify the public endpoint:

```bash
curl --fail --show-error https://voice.example.com/healthz
```

Before the Connector is online, `connectorReady` is `false`. It becomes `true`
only after the outbound Connector has connected and its local AgentRuntime has
successfully initialized.

The two WSS endpoints are:

```text
wss://voice.example.com/v1/device
wss://voice.example.com/v1/connector
```

## Operate

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml logs -f --tail=200
docker compose --env-file deploy/.env -f deploy/compose.yaml pull
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

Back up the `caddy_data` volume if certificate/account continuity matters. Relay
active turns are intentionally in memory; restarting Relay fails the current
turn and both clients reconnect for the next one.

Do not publish port 8787, put credentials in URLs, or place an OpenClaw Gateway
token in `deploy/.env`.
