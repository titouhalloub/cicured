FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/schemas/package.json packages/schemas/
COPY packages/parser/package.json packages/parser/
COPY packages/runner/package.json packages/runner/

RUN pnpm install --frozen-lockfile --filter @sft/api...

COPY apps/api apps/api
COPY packages/schemas packages/schemas
COPY packages/parser packages/parser
COPY packages/runner packages/runner

WORKDIR /app/apps/api

EXPOSE 4000
ENV NODE_ENV=production

CMD ["node", "-r", "@swc-node/register", "src/main.ts"]
