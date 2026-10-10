# The worker launches sandbox containers via the Docker socket.
# In production, mount a socket proxy rather than the raw socket;
# see deploy/README.md.

FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/schemas/package.json packages/schemas/
COPY packages/parser/package.json packages/parser/
COPY packages/runner/package.json packages/runner/

RUN pnpm install --frozen-lockfile --filter @sft/worker...

COPY apps/worker apps/worker
COPY packages/schemas packages/schemas
COPY packages/parser packages/parser
COPY packages/runner packages/runner

WORKDIR /app/apps/worker

ENV NODE_ENV=production

CMD ["tsx", "src/index.ts"]
