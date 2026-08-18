FROM node:24-bookworm-slim

ARG LIBGOMP_URL=https://deb.debian.org/debian/pool/main/g/gcc-12/libgomp1_12.2.0-14+deb12u1_amd64.deb
ADD --checksum=sha256:48fec46bda7f5b1638b9e959889bfbc20491247d402d120bb152687eb48143d7 ${LIBGOMP_URL} /tmp/libgomp1.deb
RUN dpkg --install /tmp/libgomp1.deb && rm /tmp/libgomp1.deb

COPY deploy/whisper/download-assets.mjs /opt/voice-satellite/download-assets.mjs

WORKDIR /opt/voice-satellite
