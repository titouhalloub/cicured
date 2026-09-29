# SFT-Dev

Git-native build & repair intelligence platform — *"CI that doesn't just tell you it broke — it tells you why and how to fix it."*

**Current milestone: M1 — Foundation** (`docs/SFT-Dev_Spec.md` §11/§14). M2 has **not** been started.

## Layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js frontend (dashboard lands in M4) |
| `apps/api` | NestJS REST API, Drizzle schema + migrations, BullMQ producer |
| `apps/worker` | **Empty M2 scaffold** (no M2 code may be written during M1) |
| `packages/schemas` | zod contracts shared across packages (§5 data shapes, rule IDs, status machine) |
| `packages/parser` | Empty scaffold (deterministic parsers land in M3) |
| `packages/runner` | Pinned `sft-dev.mjs` + its exit-code/timeout/config tests (§2) |
| `docs` | Canonical spec + the pinned runner as provided |

## Quick start

```bash
cp .env.example .env          # fill SESSION_SECRET + SFT_ENCRYPTION_KEY (GitHub creds optional for M1)
docker compose up -d          # Postgres 16 + Redis 7
pnpm i
pnpm db:migrate
pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

API dev server: `pnpm --filter @sft/api dev` → `GET http://localhost:4000/health`.

## M1 acceptance criteria (§14)

1. `docker compose up -d && pnpm i && pnpm -r typecheck && pnpm -r lint && pnpm -r test` passes.
2. Creating a run via the API inserts a `queued` row **and** a BullMQ job — covered by
   `apps/api/test/runs.integration.spec.ts` (it skips when Postgres/Redis are unreachable, so bring infra up to exercise it).
3. No secrets in the repo; `.env.example` only.

## M1 implementation notes (decisions & deviations)

1. **`logs` table** — required by kickoff §14 deliverable 3 but undefined in §5. Implemented as *log archive segment metadata* (`run_id`, `stream`, `sequence`, `s3_key`, `byte_size`, `created_at`) so Postgres never stores log bodies and the 30-day S3 TTL (§2/§8) can purge segments.
2. **`users.provider_user_id`** — additive column required to upsert OAuth identities; §5's sketch omits it.
3. **`runs.created_at`** — additive column for queue ordering; `status` defaults to `queued`.
4. **Sessions** — signed httpOnly cookie (HMAC-SHA256 over `SESSION_SECRET`); §5 defines no sessions table and no extra dependency is added.
5. **Encrypted columns** — AES-256-GCM with `SFT_ENCRYPTION_KEY` (`installation_id_enc`, `value_enc`); KMS/Vault is post-MVP (§13).
6. **`GET /repos`** — requires `?installationId=`, mints a GitHub App installation token (1h TTL) and lists that installation's repos. User OAuth tokens are never persisted.
7. **`GET /health/ready`** added next to liveness `GET /health` for the ops metrics in §9.
8. **Unique indexes for idempotency**: `projects(provider, repo_full_name)`, `findings(run_id, fingerprint)`, `project_env_vars(project_id, key)`, `webhook_deliveries(provider, delivery_id)`.
9. **`packages/runner/sft-dev.mjs` is byte-identical** to the provided `docs/sft-dev2.mjs`; a sha256 pin test fails if it is edited without updating tests.
10. **Run creation is two-phase**: insert `queued` row → enqueue BullMQ job (`jobId = runId`). If the enqueue fails the row is marked `cancelled` and the API returns 503 (no orphan `queued` rows).

### Internal packages are consumed as TypeScript source

Workspace packages point `main`/`types` at `src/index.ts`. tsc, Vitest, tsx and Next (`transpilePackages`) all consume that directly — no build ordering problems in M1. Publish-ready builds are post-MVP.

## Docs

- `docs/SFT-Dev_Spec.md` — canonical spec, the single source of truth.
- `docs/sft-dev2.mjs` — the pinned runner exactly as provided (§2); the test
  suite asserts its sha256 so any change is deliberate.

Business material (the product `.docx` and the raw spec download it came with)
is deliberately **not** kept in the repo: §14 scopes the work to the spec, and
§13 lists everything the business doc asks for that is out of MVP scope.
