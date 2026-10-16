
```markdown
## §N — Sandbox performance hardening (Phase 4-prep)

**Status:** backlog, not scheduled
**Depends on:** Phase 3a (Semgrep), Phase 3c-1 (pnpm store cache)
**Unlocks:** Warm-run latency under 3 minutes on any repo

### Why this exists

Every cold run costs 10–20 minutes: 8–10 min for install, 1–3 min
for Semgrep rule download, 3–5 min for serial task execution. Once
the caches are warm, the same run drops to 2–4 min. The gap between
those two numbers is the difference between "cicured is a demo" and
"cicured is a tool a team relies on daily."

The three levers below are independent and can be shipped in any
order. Do them in the listed order for the biggest cumulative gain.

### Lever 1 — Cache Semgrep rules in the image

**Problem:** `--config=auto` fetches the rule bundle from
`semgrep.dev` on every run. On a slow connection this adds 1–3 min
and makes findings non-deterministic — same code, updated rules,
different `check_id`, different fingerprint, cached LLM suggestion
invalidated.

**Fix:** Bake a pinned rule set into the sandbox image at build time.

- At image build, run `semgrep --config=p/ci --dryrun` (or an
  equivalent rule-fetch command) into `/opt/sft/semgrep-rules/`.
- Change the Security task command to
  `semgrep --config=/opt/sft/semgrep-rules --json --no-git-ignore --quiet --metrics=off`
- Update `detect-tasks.spec.ts` exact-command assertion.
- Add a build arg `SEMGREP_RULES_VERSION` so the pinned rule version
  is visible in `docker inspect`.

**Cost:** ~1 session. Image grows by ~100–200 MB.
**Wins:** 1–3 min per run; deterministic fingerprints; offline-capable.

### Lever 2 — Pre-warm package caches in the image

**Problem:** Every run downloads node_modules, cargo crates, go
modules, and Python wheels from scratch. On a fast datacenter this is
40 seconds; on a slow connection it's 8–10 minutes.

**Fix:** Extend `docker/sandbox/Dockerfile` to warm the most common
caches at build time. The sandbox reads from them on first run; the
worker's host-side pnpm store (already landed) covers subsequent
runs.

Concretely:

- **pnpm store:** `pnpm add -g typescript eslint prettier vitest jest
  @types/node tsx` in the image. ~400 MB, covers 80% of TS repos.
- **Cargo registry:** `cargo install --no-default-features clippy`
  or a dummy `cargo fetch` against a manifest listing common crates
  (serde, tokio, anyhow). ~200 MB.
- **Go modules:** `GOPATH=/usr/local/go-mod go install
  golang.org/x/tools/cmd/goimports@latest` plus a
  `go mod download` against a common module set. ~150 MB.
- **Python wheels:** `pip download pytest mypy ruff black -d
  /opt/sft/python-wheels` then `pip install --no-index --find-links
  /opt/sft/python-wheels`. ~80 MB.

Set the cache env vars in `docker/sandbox/entrypoint.sh`:
```
export PNPM_STORE_DIR=/pnpm-store
export CARGO_HOME=/usr/local/cargo
export GOPATH=/usr/local/go-mod
export PIP_CACHE_DIR=/opt/sft/pip-cache
```

**Cost:** ~1 session. Image grows from ~600 MB to ~1.5 GB.
**Wins:** Cold install drops from 8–10 min to 1–2 min on the first
run against a new repo; near-zero on warm runs.

**Trade-off to decide:** Bigger image = slower first pull on a new
host. For a self-hosted deployment this is one-time. For the SaaS
worker, the image is pulled once per host and cached forever.

### Lever 3 — Parallel task execution

**Problem:** Tasks run serially: Type Check → Lint → Build → Tests →
Security. Total wall time is the sum. On a repo where each task
takes 30–60s that's 3–5 min of avoidable serialization.

**Fix:** Give each task a `dependsOn: string[]` field (default `[]`)
and run them through a small topological scheduler with a concurrency
cap.

Current dependency graph:
```
Type Check  (no deps)
Lint        (no deps)
Build       (no deps)
Tests       (depends on Build)
Security    (no deps)
```

Optimal schedule with concurrency 4:
```
[start] → Type Check, Lint, Build, Security (parallel)
       → Tests (when Build finishes)
       → [done]
```

Wall time drops from sum(5 tasks) to max(TypeCheck, Lint, Build,
Security) + Tests. On a repo with even task durations this is a
40–50% speedup.

**Implementation sketch:**
- Add `dependsOn?: string[]` to the task shape in
  `packages/runner/sft-dev.mjs`
- Add a `scheduler.js` module: Kahn's algorithm over the task graph,
  cap at 4 concurrent
- Each task's stdout/stderr captured independently; report ordering
  preserved by task declaration order, not completion order
- Deadline check remains global; a task that would exceed the budget
  is skipped with reason "global deadline exceeded"
- Failure handling: if Type Check fails, Lint still runs (they're
  independent). If Build fails, Tests is skipped with reason
  "dependency failed"

**Cost:** ~2 sessions (scheduler + tests + report ordering).
**Wins:** 40% wall-time reduction on repos with 4+ independent tasks.

### Sequencing

1. **Lever 1** first — smallest, biggest determinism win, unblocks
   the fingerprint-caching story for the SaaS layer.
2. **Lever 2** second — biggest cold-start win, most visible to users.
3. **Lever 3** third — biggest warm-run win, most complex, most
   test surface.

After all three: cold run ~3–4 min, warm run ~1–2 min on a mid-size
repo. That's the number to put on the landing page.

### What not to do

- **Don't parallelize inside a task.** `pnpm -r build` already uses
  turbo's parallelism. Wrapping it with another layer is churn.
- **Don't cache task *results* yet.** Skipping a task because its
  inputs haven't changed is tempting but requires a working
  content-hash of the task's inputs (lockfile + source files +
  toolchain version). Defer to Phase 5 or later.
- **Don't add a warm-up daemon.** The image bakes the caches; the
  sandbox reads them. No persistent process needed.

### Success criteria

- Median warm run on `titouhalloub/cicured` under 3 minutes
- Cold run on a fresh clone under 5 minutes
- Semgrep findings have stable fingerprints across runs (rule
  version pinned)
- No regressions in `pnpm -r test`; runner suite grows by
  ~10 tests for the scheduler
```

