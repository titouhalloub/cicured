# SFT-Dev

Git-native build & repair intelligence platform — *"CI that doesn't just tell you it broke — it tells you why and how to fix it."*

**Current milestone: M2a — Worker + sandbox** (`docs/SFT-Dev_Spec.md` §11). M2b (log streaming, SSE, S3 archival, webhooks) has **not** been started.

## Deploy

Production deployment uses a Compose overlay: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
See **[`deploy/README.md`](deploy/README.md)** for the full runbook (prerequisites, secrets, socket proxy, operations).

## Layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js frontend (dashboard lands in M4) |
| `apps/api` | NestJS REST API, Drizzle schema + migrations, BullMQ producer |
| `apps/worker` | BullMQ consumer + one hardened Docker sandbox per run (M2a) |
| `packages/schemas` | zod contracts shared across packages (§5 data shapes, rule IDs, status machine) |
| `packages/parser` | Empty scaffold (deterministic parsers land in M3) |
| `packages/runner` | Pinned `sft-dev.mjs` + its exit-code/timeout/config tests (§2) |
| `docker/sandbox` | `cicured/sandbox:node20` image + entrypoint (clone → install → runner) |
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

## Running M2a locally

1. `docker compose up -d` (Postgres + Redis) and `pnpm i`; copy `.env.example` → `.env` and fill `SESSION_SECRET`, `SFT_ENCRYPTION_KEY`, `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`.
2. `pnpm db:migrate`, then build the sandbox image from the **repo root**: `docker build -f docker/sandbox/Dockerfile -t cicured/sandbox:node20 .`.
3. Start both processes: `pnpm --filter @sft/api start` and `pnpm --filter @sft/worker start` (the worker needs access to `/var/run/docker.sock`).
4. Create a project and a run via the API (`POST /projects`, then `POST /projects/:id/run`) — the API inserts a `queued` row and enqueues the job.
5. The worker picks it up, launches one container (clone → lockfile-aware install → pinned runner) and classifies the exit code: `0`→`success`, `1`→`failed`, `2`→`runner_crash`, over budget→`timeout`.
6. Check `apps/worker/tmp/reports/<runId>.json` for the zod-validated `sft-report.json` and `SELECT status, exit_code, failure_kind, build_minutes FROM runs WHERE id = '<runId>';`.

### M2b requires

M2b MUST add the egress allowlist proxy from Spec §8 before any external traffic is enabled. Default bridge network is acceptable for local M2a only.

## M2a implementation notes (decisions & deviations)

1. **Container launch via dockerode**, never `docker run`; hardening is set per container (read-only rootfs, tmpfs `/workspace` 1 GB + `/tmp` 64 MB, `no-new-privileges`, default seccomp, `CapDrop: ALL`, 4 GB / 2 CPU). `AutoRemove` stays **false** so the container's lifetime is explicit — the worker removes it in a `finally` block.
2. **Runner injection is a read-only bind mount** of `packages/runner/sft-dev.mjs` to `/opt/sft/sft-dev.mjs`, resolved from `SFT_RUNNER_HOST_PATH` (defaults to the repo path) and verified at boot. The runner is never copied from the user's repo and never installed.
3. **Credentials** — the worker mints a GitHub App installation token per run and passes it as `GIT_TOKEN`; the entrypoint unsets `GIT_*`/`GITHUB_*` *before* launching the runner (which scrubs them again). Tokens never reach Postgres, job payloads or logs; `apps/worker/src/common/secrets.ts` masks them in every log line.
4. **Deadline arithmetic lives in the entrypoint** (`SFT_DEADLINE_MS = budget − installMs − 60 s`) so the container's own wall clock — not a worker-side estimate — decides the runner deadline (§2 pre-flight).
5. **Writable paths on a read-only rootfs**: the entrypoint redirects `HOME`, `npm`/`pnpm`/`yarn`/corepack caches into the `/workspace` tmpfs and sets `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, otherwise installs hang or fail.
6. **The report leaves via a bind mount, not Docker.** `/workspace` is a tmpfs, so when the container exits Docker unmounts it and `sft-report.json` is gone — `getArchive` then answers 404. Instead each run gets a host directory `REPORTS_DIR/<runId>` bind-mounted at `/out` (mode `0777`, because the sandbox user is uid 1001 and the worker cannot chown); the entrypoint copies the report there after the runner exits and propagates the runner's exit code via an explicit `exit "$runner_exit"`. The worker validates from disk with the shared `parseSftReport` (zod + 2 MB cap), writes `<REPORTS_DIR>/<runId>.json` mode `0600`, and removes the per-run directory. A missing or invalid report makes the run `runner_crash` even on exit 0/1, because there is nothing for M3's parser to consume.
7. **Worker tables mirror the API's** (`apps/worker/src/tables.ts`) instead of importing the whole API app; `test/schema-parity.spec.ts` imports the API's real definitions so the duplication cannot drift silently. A shared `@sft/db` package is a post-M2a cleanup.
8. **Job payload**: M1 sends `{ runId, projectId }`; the worker resolves the project from the run row and logs `deprecated projectId in queue payload (M1 compatibility)` so the occurrences are greppable until the cleanup.
9. **S3 columns stay null in M2a** — reports are written to `REPORTS_DIR` on the worker host; archival with the 30-day retention boundary is M2b.
10. **`sft-dev.config.json`** at the repo root pins this repo's own tasks (typecheck → lint → build → tests) for the runner's config-override hook.

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
9. **`packages/runner/sft-dev.mjs` is the canonical pinned runner.** The redundant `docs/sft-dev2.mjs` copy was removed in M2a; a sha256 pin test fails if the canonical artifact is edited without updating tests.
10. **Run creation is two-phase**: insert `queued` row → enqueue BullMQ job (`jobId = runId`). If the enqueue fails the row is marked `cancelled` and the API returns 503 (no orphan `queued` rows).

### Internal packages are consumed as TypeScript source

Workspace packages point `main`/`types` at `src/index.ts`. tsc, Vitest, tsx and Next (`transpilePackages`) all consume that directly — no build ordering problems in M1. Publish-ready builds are post-MVP.

## Docs

- `docs/SFT-Dev_Spec.md` — canonical spec, the single source of truth.
- `packages/runner/sft-dev.mjs` — the pinned runner, the canonical artifact (§2).
  The test suite asserts its sha256 so any change is deliberate.

Business material (the product `.docx` and the raw spec download it came with)
is deliberately **not** kept in the repo: §14 scopes the work to the spec, and
§13 lists everything the business doc asks for that is out of MVP scope.

### Test Review
const x = 1; // Triggering the review bot

