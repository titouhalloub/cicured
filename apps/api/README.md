# @sft/api

NestJS REST API for SFT-Dev (M1 foundation). TypeScript end-to-end; all shared
shapes come from `@sft/schemas` (zod), all persistence goes through Drizzle.

## Endpoints (Spec §6)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness (no dependencies) |
| GET | `/health/ready` | readiness: Postgres + Redis, 503 when degraded |
| GET | `/auth/github` | browser redirect to GitHub OAuth (state cookie) |
| GET | `/auth/github/callback` | code exchange + session cookie + redirect to `WEB_APP_URL` |
| POST | `/auth/:provider/callback` | SPA flow, returns `{ user }` and sets the cookie |
| POST | `/auth/logout` | clears the session cookie |
| GET | `/auth/me` | current session user |
| GET | `/repos?installationId=` | repos of one GitHub App installation |
| POST | `/projects` | connect a repo (installation id stored AES-256-GCM encrypted) |
| POST | `/projects/:id/run` | **202** creates a `queued` run + BullMQ job (`jobId = runId`) |
| GET | `/projects/:id/runs` | paginated (`limit` ≤ 100, `offset`) |
| GET | `/runs/:id` | single run |

Everything under `/repos`, `/projects`, `/runs` requires the session cookie
(`sft_session`, HMAC-SHA256 signed, httpOnly).

## Scripts

```bash
pnpm --filter @sft/api dev          # tsx watch (needs .env)
pnpm --filter @sft/api db:generate  # drizzle-kit generate -> ./drizzle
pnpm --filter @sft/api db:migrate   # applies ./drizzle migrations
pnpm --filter @sft/api test         # vitest (integration test auto-skips without infra)
```

## Notes

- `runs.integration.spec.ts` is the live check for M1 acceptance criterion 2
  (queued row + BullMQ job). It skips itself when Postgres/Redis are down.
- Vitest runs the API through `unplugin-swc`: esbuild cannot emit
  `design:paramtypes`, and NestJS DI depends on that metadata.
- Unit tests stub Drizzle chains with one documented cast; real persistence is
  exercised by the integration test.
