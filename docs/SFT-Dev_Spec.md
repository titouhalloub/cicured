# SFT-Dev — Technical Spec (v2.0, merged & corrected)

This document supersedes `SFT-Dev_Technical_Plan.md` and `CLINE_KICKOFF.md`. There is no precedence order — this file is the single source of truth. Where the prior docs disagreed (task order, timeouts, sandbox platform, buffer caps), the resolution is stated inline with a **⚠ RESOLVED** marker.

Companion files:
- `sft-dev2.mjs` — pinned runner. Do not modify without adding/adjusting its tests.
- `React-Nextjs-Tester-project.docx` — business/product vision. **Not a spec.** See §13 for what is explicitly out of MVP scope.

---

## 0. Locked decisions

| Topic | Decision |
|---|---|
| Repo layout | pnpm monorepo: `apps/web` (Next.js), `apps/api` (NestJS), `apps/worker` (Node/TS), `packages/runner` (copied `sft-dev2.mjs` + tests), `packages/schemas` (zod), `packages/parser` |
| API framework | NestJS (TypeScript end to end, shares zod schemas) |
| ORM / migrations | Drizzle + drizzle-kit, PostgreSQL 16 |
| Queue | BullMQ on Redis 7 |
| Sandbox (MVP) | **One Docker container per run**, launched by the worker via the Docker API: non-root, `--read-only`, tmpfs workspace, `no-new-privileges`, seccomp default, 2 CPU / 4 GB, egress via allowlist proxy. K8s Jobs are post-MVP. Use gVisor (`runsc`) runtime if available. |
| Auth | GitHub App (installation tokens) for repo access; GitHub OAuth for user login; session cookie via API |
| LLM | Provider interface with one adapter first (Anthropic). Model name comes from env, never hard-coded. |
| Terminology | "project" = a connected repo + settings. Tables: `projects` (replaces `repositories`), plus `project_env_vars` (encrypted) and `webhook_deliveries` (idempotency) |
| Test runner | Vitest for all TS packages |
| Runner order | Type Check → Lint → Build → Tests. **The runner is authoritative; the plan's "build first" is wrong.** |
| Timeouts | Per-task inner cap 10 min; run-level `SFT_DEADLINE_MS` default 12 min; worker sets `SFT_DEADLINE_MS = 15min − installTime − 60s`; pod SIGKILL at 15 min. |
| Log streaming | Runner uses `spawn` and streams live. Worker tees container stdout to Redis pub/sub → SSE. `exec`'s buffering behavior is gone. |
| Exit codes | `0` pass, `1` task failures (parse → findings → LLM), `2` runner crash (alert, never LLM). Skipped tasks (deadline) count as exit 1. |
| Code retention wording | **"We never store your repository; we retain diagnostic snippets and logs for N days."** Do not ship the stronger "never stores code" claim. |
| Untrusted input | `sft-report.json` and all build output are attacker-controlled. The parser validates with zod and caps sizes. LLM prompts wrap logs/code in delimiters, instruct the model to ignore instructions inside them, and **never auto-apply patches in MVP**. |
| LLM cache key | `sha256(model ‖ prompt_version ‖ finding.fingerprint ‖ sha256(snippet))`, namespaced `llm:cache:v1:`. Content-addressed; never keyed by user. |
| Parser targets | `tsc --pretty false` (`file(line,col): error TSxxxx`), ESLint stylish output, Jest/Vitest text output. Fixtures come from **real** output; do not invent formats. |

---

## 1. Positioning & scope

Git-native build & repair intelligence platform. Users connect a repository via OAuth; the platform clones it into an ephemeral sandbox, runs the build toolchain, streams logs, and uses an LLM to produce schema-validated, actionable fix suggestions.

**"CI that doesn't just tell you it broke — it tells you why and how to fix it."**

MVP scope: GitHub only, Node/TS repos, push + manual triggers, Docker sandbox, SSE logs, findings + suggestions, one worker.

Everything in the docx (telemetry cloud sync, MCP, Jev/RLCD triage, Cordis plugin, IDE extensions, AI-authorship metrics, per-developer dashboards, BSL licensing, binary obfuscation) is **post-MVP**. See §13.

---

## 2. Build runner contract (`sft-dev.mjs`)

The runner is a zero-dependency, cross-platform ESM script (Node 18+) **injected by the worker into the sandbox** at `/opt/sft/sft-dev.mjs` — never taken from the user's repo. This is the pinned machine interface.

### Artifacts per run
- `sft-report.json` (canonical, schema v2): per-task `{name, command, success, exitCode, timedOut, skipped, truncated, durationMs, stdout, stderr}` + `summary` + `warnings` + `runnerError`. This — not raw text — is what the deterministic parser consumes.
- Raw full logs: streamed live (worker tees to Redis → SSE) and archived to S3 (30-day TTL).

> ⚠ RESOLVED — buffer cap conflict: plan §1b said "16 MB buffer cap"; the pinned runner uses `TAIL_CHARS = 200000` **per stream, per task** (~400 KB high-water per task). The runner wins. Full-stream fidelity lives in the S3 tee, not in the report. The parser additionally caps: input report ≤ 2 MB, per-task `stdout`/`stderr` ≤ 200 KB after zod validation, findings capped at top 50 per run.

### Exit-code semantics (worker behavior spec)
| Code | Meaning | Worker action |
|---|---|---|
| `0` | All tasks passed | Persist `success` |
| `1` | Task failures — NORMAL outcome | Parse report → findings → LLM |
| `2` | Runner crash | Operational alert; **do NOT** send to LLM |

Skipped tasks (global deadline exhausted) are counted as exit 1.

### Runner guarantees
- Scrubs git provider tokens from env: `GIT_*`, `GITHUB_*`, `GITLAB_*`, `GH_*`, `GL_*`
- Sets `FORCE_COLOR=0`, `CI=true`, prepends `node_modules/.bin` to `PATH`
- Plain parseable output; per-task timeout 10 min; global deadline via `SFT_DEADLINE_MS` (default 12 min)
- Process-group kill on timeout (no orphaned `next build`)
- Toolchain auto-detection from `package.json`; `sft-dev.config.json` override hook
- **Never installs dependencies itself** — hermetic by design

### Worker pre-flight (before invoking runner)
1. Detect lockfile → `npm ci` / `pnpm i --frozen-lockfile` / `yarn --frozen-lockfile`
2. Measure install wall-time
3. Set `SFT_DEADLINE_MS = (15 * 60 * 1000) − installMs − 60_000`
4. Invoke `/opt/sft/sft-dev.mjs`

---

## 3. System architecture

```
Frontend (Next.js) ─► API (NestJS REST) ─┬─► PostgreSQL (state)
                                          └─► Redis (BullMQ queue, LLM cache)
Webhook ingestion ─► enqueue ─► Worker fleet (Docker container per run)
                                 │
                                 ├─ clone → install → inject runner → build
                                 ├─ live stdout → Redis pub/sub → SSE
                                 └─ sft-report.json → Parser → Findings ─► AI Service ─► Suggestions
                                                                    │
                                                                    └─► S3 (raw logs, 30d TTL)
```

Components: Frontend (Next.js/TS/Tailwind) · API (NestJS) · Queue (Redis + BullMQ) · Worker (Docker container per run) · Runner (`sft-dev.mjs`) · Log parser (Node) · AI Service (LLM + JSON schema) · Storage (PostgreSQL + S3) · Secrets (KMS, with Vault post-MVP).

> ⚠ RESOLVED — plan §1 corr. #2 / §3 steps 3, 10 said "K8s pod" / "K8s lifecycle". MVP is Docker containers launched via the Docker API. K8s Jobs are post-MVP (§13).

---

## 4. Core workflow

1. Connect repo via GitHub App install; store encrypted installation ID.
2. Trigger: push webhook (branch filter) or manual "Run" → `runs` row (`queued`) → BullMQ job.
3. Worker claims job; enforces per-user concurrency limits; dedups same `project + sha`.
4. Sandbox bootstrap: fresh container, egress allowlist (npm registry, git provider), read-only root FS, tmpfs workspace, 2 CPU / 4 GB / 15 min wall limit.
5. Clone: short-lived broker-minted token; `git clone --depth 1 --branch <b>`; submodules off by default.
6. Install + build: worker detects lockfile, installs deps, injects `/opt/sft/sft-dev.mjs`, runs it. Emits `sft-report.json` (v2) + live logs.
7. Log streaming: worker publishes chunks to Redis → API fans out via SSE.
8. Analysis pipeline (two layers, in order):
   - **Deterministic parser** consumes `sft-report.json`, validates with zod, classifies findings (TS error, missing default export, lint violation, failed test) with file/line/col — no LLM.
   - **LLM layer** receives structured findings + minimal code snippets → schema-validated suggestions (unified-diff patches, not prose).
9. Persist: `runs`, `findings`, `suggestions` to Postgres; raw logs + validated report to S3 (30-day TTL).
10. Cleanup: container destroyed by worker lifecycle even on timeout. Workspace never touches durable disk.
11. Feedback: accept/reject → eval set for AI quality tracking.

---

## 5. Data model (PostgreSQL)

```
users:               id, email, provider, plan, created_at
projects:            id, user_id, provider, repo_full_name, installation_id(enc),
                     default_branch, webhook_id, created_at
project_env_vars:    id, project_id, key, value_enc, created_at
webhook_deliveries:  id, provider, delivery_id, received_at, payload_sha256   # idempotency
runs:                id, project_id, sha, branch, trigger (push|manual|pr),
                     status, exit_code, failure_kind, started_at, finished_at,
                     build_minutes, s3_log_key, s3_report_key
findings:            id, run_id, severity, category (build|typecheck|lint|test),
                     rule_id, file, line, col, message, fingerprint
suggestions:         id, finding_id, model, prompt_version, patch_diff,
                     explanation, confidence, accepted bool null, created_at
```

### `RunStatus` enum
`queued | running | success | failed | runner_crash | timeout | cancelled`

> ⚠ RESOLVED — plan §4 listed `queued|running|success|failed|timeout|cancelled`; kickoff M1 required a `RunStatus` schema. Added `runner_crash` so exit-2 outcomes are dashboard-distinguishable from exit-1. `failed` covers exit 1 (including deadline-skips).

### `failure_kind` enum (nullable)
`task_failure | runner_crash | timeout | cancelled | oom`

### `rule_id` format (locked)
| Source | Format | Example |
|---|---|---|
| tsc | `TS<code>` | `TS2339` |
| eslint | `<rule>` or `<plugin>/<rule>` | `no-unused-vars`, `@typescript-eslint/no-explicit-any` |
| jest / vitest | `<relTestPath>::<full test name>` | `src/a.test.ts::auth › rejects expired token` |
| next build | Next error code, else `fingerprint` hash | `NEXT_BUILD_<hash>` |

> ⚠ RESOLVED — plan §4 left `rule_id` unspecified; kickoff #8 required parsers to emit rule IDs. This table is the contract for `packages/parser`.

### `runs.exit_codes jsonb` → `exit_code int`
> ⚠ RESOLVED — the runner emits one exit code per run (0/1/2). Per-task exit codes live inside the validated report, which is now stored in S3 (`s3_report_key`) rather than Postgres, to keep row sizes bounded and keep diagnostic snippets inside the 30-day retention boundary. Only `exit_code` and `failure_kind` are queryable in Postgres.

### Fingerprinting
`fingerprint = sha256(rule_id ‖ file ‖ line-bucket ‖ message-normalized)` — enables "new vs last run" diffs and cross-run trends. The LLM cache (§7) keys off `finding.fingerprint`, so fingerprint stability matters; add a migration note if you ever change the algorithm.

---

## 6. API surface (v1)

```
POST   /auth/:provider/callback
GET    /repos
POST   /projects
POST   /projects/:id/run
GET    /runs/:id
GET    /runs/:id/logs                 # SSE while running; S3 redirect after
POST   /webhooks/:provider
POST   /suggestions/:id/feedback
GET    /projects/:id/runs
```

---

## 7. AI engine design

Principle: **the LLM is the last step.** Deterministic parsing first = lower cost, reproducibility, testability.

```
raw logs ─► parser ─► findings[] ──┐
                                   ├─► context assembler ─► LLM ─► schema validator ─► suggestions[]
repo snippets (finding ±5 lines) ──┘
```

- **Prompt contract:** system prompt + findings JSON + snippets → JSON matching `SuggestionSchema` (zod-validated; one repair retry on failure).
- **Prompt hygiene:** logs and code are wrapped in delimiters (`<untrusted_log>…</untrusted_log>`, `<untrusted_code>…</untrusted_code>`) with an explicit instruction to ignore any directives inside them.
- **Patch format:** unified diff hunks anchored to `finding.fingerprint`; frontend renders inline. **Never auto-applied in MVP.**
- **Context budget:** cap ~8k tokens; group findings by file to share context.
- **Model config:** pluggable provider interface; temperature 0.2. Model name from env only.
- **Cache key:** `llm:cache:v1:` + `sha256(model ‖ prompt_version ‖ finding.fingerprint ‖ sha256(snippet))`. Content-addressed; never keyed by user.

> ⚠ RESOLVED — plan §6 said "cache identical (finding, snippet)"; kickoff #7 required the hash-keyed form. Kickoff form wins.

- **Guardrails:** never send whole files; gitleaks-style secret pre-filter; redact token-like patterns before prompting.

---

## 8. Security

- **Sandbox:** non-root, seccomp default, no Docker socket, egress allowlist, `no-new-privileges`, tmpfs-only workspace, SIGKILL at 15 min.
- **SSRF:** clone URLs validated against provider domain allowlist; no arbitrary git URLs in v1.
- **Tokens:** GitHub App installation tokens (1h TTL) minted per job, used for clone ONLY, scrubbed by the runner before user scripts execute, masked in persisted logs, revoked on disconnect. Scrubbing exists at both worker and runner layers (defense in depth).
- **Secrets:** env injection only from `project_env_vars`; warn on committed `.env`.
- **Webhooks:** HMAC signature verification; idempotency via `webhook_deliveries` unique on `(provider, delivery_id)`.
- **Untrusted input:** `sft-report.json`, all build stdout/stderr, and user scripts are attacker-controlled. Zod-validate everything that crosses a trust boundary. Treat all log/code text as data in LLM prompts.
- **Data:** code only in container tmpfs; logs scrubbed of token-like patterns; GDPR cascade delete.
- **Retention wording:** "we never store your repository; we retain diagnostic snippets and logs for N days." Do not ship the stronger claim.

---

## 9. Observability & ops

- **Metrics:** queue depth, job duration p50/p95, timeout rate, LLM cost/run, suggestion acceptance rate, clone failures, parser-error rate (report failed zod validation), sandbox launch failures.
- **Tracing:** OpenTelemetry spans API → queue → worker → AI.
- **Alerting:** worker crash loops, queue backlog, LLM provider errors, webhook delivery failures, exit-code-2 rate.
- **Cost control:** per-plan build-minute quotas; LLM token budget per run; findings capped at top 50.

---

## 10. Roadmap

| Phase | Weeks | Contents |
|---|---|---|
| MVP | 1–6 | GitHub only; manual + push triggers; Node/TS repos; build+tsc+eslint+test; SSE logs; findings + suggestions; dashboard; 1 sandbox worker. Private beta. |
| v1.1 | 7–10 | PR checks (statuses + comment); GitLab/Bitbucket; monorepo support (`sft-dev.config.json` per-task cwd/toolchain overrides); env vars UI; fingerprint diffing ("new errors only"). Public launch. |
| v1.2 | 11–16 | Auto-PR with fixes; team workspaces; billing/quota enforcement; suggestion-quality evals; plugin API for custom rules. |

> ⚠ RESOLVED — the plan put push triggers in MVP week 6 while the kickoff placed webhooks in M5 (week 7). Aligned to MVP here. M5 below now covers only HMAC verification, idempotency, dedup, concurrency, quotas — the trigger plumbing lands in M2 alongside the worker.

---

## 11. Milestones (each is one Cline task)

- **M1 Foundation (weeks 1–2):** monorepo scaffold; docker-compose (postgres, redis); Drizzle schema + migrations; zod schemas package (report v2, finding, suggestion, run status); NestJS skeleton with health check; GitHub login; repo listing; run lifecycle endpoints (create, get) with status transitions.
- **M2 Worker + sandbox (weeks 3–4):** BullMQ consumer; Docker sandbox launcher; credential broker; clone; lockfile-aware install; inject runner; exit-code handling; live log tee to Redis; SSE endpoint; S3 log + report archive; push webhook trigger with branch filter.
- **M3 Parser (week 5):** report validator; tsc/eslint/jest parsers with real-output fixtures; fingerprints; findings persistence.
- **M4 AI + UI (week 6):** context assembler; secret pre-filter; LLM adapter; schema-validated suggestions with repair retry; dashboard (runs list, run detail with live logs, findings, diff view); feedback buttons.
- **M5 Hardening (week 7):** HMAC verification; webhook idempotency; dedup `project+sha`; concurrency limits; quotas; alerting.

---

## 12. `.clinerules` (repo root)

```
# SFT-Dev project rules
- Read SFT-Dev_Spec.md before any task. It is the single source of truth; the plan and kickoff docs are superseded.
- Work one milestone at a time. Do not start the next milestone. Stop when acceptance criteria pass.
- TypeScript strict mode everywhere. No `any` without a comment justifying it.
- All cross-package data shapes live in packages/schemas as zod schemas. Never redefine them elsewhere.
- Never put secrets in code, logs, job payloads or DB rows. Tokens are passed via env only.
- packages/runner/sft-dev.mjs is pinned: do not modify it without adding/adjusting its tests.
- Every feature ships with tests. Run `pnpm -r typecheck && pnpm -r lint && pnpm -r test` before declaring done.
- Ask before adding a dependency that is not already in §0.
- Commit per logical step with conventional commit messages.
```

---

## 13. Explicitly out of MVP scope (post-MVP backlog)

The following appear in `React-Nextjs-Tester-project.docx` and are **not** to be built during M1–M5. They are recorded here so they don't get re-litigated or accidentally implemented:

- Local telemetry cache (`.sft/cache.json`) and cloud sync
- MCP server / IDE extensions (Cursor, VS Code, Zed)
- DeepSeek Harness / Cordis plugin wrapper (`sft-harness-plugin.js`)
- Jev / RLCD triage layer for environmental-error classification
- Per-developer AI-authorship metrics, "AI Token Waste", "Friction Index", flaky-test detection, "Cost Avoidance via AI Guardrails"
- BSL licensing, binary obfuscation (PKG/Bun), API key gating for team tiers
- BYOK tier, managed-AI premium tier
- Cloud team dashboard, Slack/MS Teams alerts, multi-user accounts

**Two decisions to make before any of these become MVP candidates:**
1. **Per-developer attribution** (`developerEmail`, `machineId`, git author) requires a DPA and likely works-council review in DE/FR. Decide now whether the Team tier is team-aggregate only, or per-developer.
2. **"AI Token Waste / $ saved" metrics** require trusting client-reported `agentSessionId` and token estimates, which the platform cannot verify. Any such number shown to managers is marketing, not a metric. Do not ship a dollar figure without a stated estimation methodology.

---

## 14. M1 kickoff prompt (paste into Cline, Plan mode)

```
Read SFT-Dev_Spec.md fully. It supersedes the previous plan and kickoff docs; there is no precedence list, this file is the source of truth.

Execute Milestone M1 only.

Deliverables:
1. pnpm monorepo with apps/web, apps/api, apps/worker, packages/runner (copy the provided sft-dev.mjs unchanged plus its tests), packages/schemas, packages/parser (empty scaffold).
2. docker-compose.yml with Postgres 16 and Redis 7; .env.example listing every variable used.
3. Drizzle schema and initial migration for: users, projects, project_env_vars, runs, findings, suggestions, logs, webhook_deliveries — per Spec §5, including the failure_kind column and the run status enum from §5.
4. zod schemas: SftReportV2 (including additive fields skipped, truncated, warnings), Finding, Suggestion, RunStatus, FailureKind. Lock rule_id formats per §5.
5. NestJS API: GET /health, GitHub OAuth login + session, GET /repos (via installation), POST /projects, POST /projects/:id/run (creates queued run + enqueues BullMQ job, no worker yet), GET /runs/:id, GET /projects/:id/runs.
6. Vitest tests for the runner (exit codes 0/1/2, timeout, global deadline skip, config validation, token scrubbing) and for run status transitions.

Acceptance criteria:
- `docker compose up -d && pnpm i && pnpm -r typecheck && pnpm -r lint && pnpm -r test` passes.
- Creating a run via the API inserts a `queued` row and a BullMQ job.
- No secrets in repo; .env.example only.

Present your plan first. Do not start M2.
```

---

## 15. Changelog vs. prior docs

**Resolved while merging:**
1. Buffer cap: runner's `TAIL_CHARS = 200000` per stream wins over plan §1b's "16 MB"; full stream lives in S3.
2. `RunStatus`: added `runner_crash` so exit-2 is distinguishable from exit-1.
3. `rule_id` format table added (was unspecified).
4. `runs.exit_codes jsonb` → `runs.exit_code int` + `failure_kind`; full report moved to S3, not Postgres.
5. LLM cache key: kickoff's hash form wins over plan §6's looser wording.
6. `repositories` → `projects`; `project_env_vars` and `webhook_deliveries` added.

**Preserved from the plan unchanged:** §1 corrections 1, 3, 4, 5, 6, 7, 8, 9, 10 (behavioral intent), §3 steps 4–9, §5 API surface, §6 AI design principles, §7 security, §8 observability, §9 roadmap, §10 build sequence.

**Preserved from the kickoff unchanged:** all of §0, all of §1 corrections, `.clinerules`, M1–M5 acceptance criteria, the M1 paste prompt (with the doc reference updated).

**Explicitly rejected:** the docx's draft runner script — it is buggier than `sft-dev2.mjs` (`+ 1000` instead of `* 1000` on hrtime, nonexistent `statusName` field, no process-group kill, invented AI-session env vars) and its report shape is incompatible with schema v2.