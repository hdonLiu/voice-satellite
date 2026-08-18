# Cloud Relay deployment

This directory deploys the single-node Relay behind Caddy. Caddy obtains a
publicly trusted certificate and proxies both HTTPS and WebSocket upgrades. The
OpenClaw Gateway is never deployed or exposed here: it stays on the Connector
computer, which makes an outbound WSS connection to this Relay.

## Prerequisites

- one Linux VPS with Docker Engine and the Compose plugin
- public TCP ports 80 and 443, plus optional UDP 443 for HTTP/3
- normally, a DNS `A`/`AAAA` record pointing the chosen domain to that VPS

The initial `device-link` deployment does not require a speech provider or a
Connector. It validates authenticated WSS and bounded ESP32 audio upload only.

## Configure

From the repository root on the VPS:

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

Edit `deploy/.env`. Generate a Device token instead of reusing a password:

```bash
openssl rand -hex 32
```

`VS_RELAY_DEVICE_TOKENS` is a JSON object. Replace `link-probe` with the ESP32
device ID and its generated credential before building firmware.

## Start

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

Verify the public endpoint:

```bash
curl --fail --show-error https://voice.example.com/healthz
```

### Public IP certificate mode

For a device-link proof without a domain, Let's Encrypt can issue a publicly
trusted, short-lived certificate for a public IPv4 or IPv6 address. Obtain and
automatically renew that certificate with an ACME client that supports IP
identifiers and the `shortlived` profile. Set these additional values:

```dotenv
VS_PUBLIC_HOST=203.0.113.10
VS_LETSENCRYPT_DIR=/etc/letsencrypt
VS_ACME_WEBROOT=/var/lib/voice-satellite/acme
```

Then start Compose with the IP override:

```bash
docker compose --env-file deploy/.env \
  -f deploy/compose.yaml -f deploy/compose.ip.yaml up -d --build
curl --fail --show-error https://203.0.113.10/healthz
```

The Let's Encrypt directory is mounted read-only into Caddy so the `live/`
links can resolve into `archive/`. The ACME webroot is also mounted read-only
into Caddy and is the only path served without proxying to Relay.

After the ACME client has been configured to renew with that webroot, install
the included timer. The environment file contains no Device credential:

```bash
sudo install -d -m 0755 /etc/voice-satellite
sudo install -m 0600 deploy/systemd/cert-renew.env.example \
  /etc/voice-satellite/cert-renew.env
sudo install -m 0644 deploy/systemd/voice-satellite-cert-renew.service \
  /etc/systemd/system/
sudo install -m 0644 deploy/systemd/voice-satellite-cert-renew.timer \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now voice-satellite-cert-renew.timer
```

The timer checks twice daily and sends `SIGUSR1` to Caddy after a successful
Certbot run so manually loaded certificate files are reprovisioned. Because IP
certificates are valid for about six days, do not treat one-time issuance as a
deployment.

In `device-link` mode, `/healthz` reports `mode: "device-link"` and
`connectorReady: false`. A completed device turn writes a structured
`device_link_audio_received` log containing only frame, byte, and duration
counts; raw audio is discarded and no transcript is produced.

The two WSS endpoints are:

```text
wss://voice.example.com/v1/device
wss://voice.example.com/v1/connector
```

Only `/v1/device` is used in this milestone. The Connector endpoint rejects
authentication until conversation mode is configured later.

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
