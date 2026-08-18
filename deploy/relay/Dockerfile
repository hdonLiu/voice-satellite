FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/relay/package.json apps/relay/tsconfig.json apps/relay/tsconfig.build.json ./apps/relay/
COPY packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/tsconfig.build.json ./packages/contracts/

RUN pnpm install --frozen-lockfile

COPY apps/relay ./apps/relay
COPY packages/contracts ./packages/contracts

RUN pnpm --filter @voice-satellite/relay... build \
    && pnpm deploy --filter @voice-satellite/relay --prod /opt/voice-satellite-relay

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /opt/voice-satellite-relay/ ./

USER node
EXPOSE 8787

CMD ["node", "dist/main.js"]
