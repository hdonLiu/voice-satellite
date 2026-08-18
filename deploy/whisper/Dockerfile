FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY deploy/whisper/download-assets.mjs /opt/voice-satellite/download-assets.mjs

WORKDIR /opt/voice-satellite

