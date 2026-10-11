# cicured — Open-Core Plan

**Status:** Living document, started 2026-10-11
**Owner:** Reda Halloub
**Related:** `SFT-Dev_Spec.md`, `deploy/README.md`

## Thesis

cicured is a paid team platform built on a free, open-source
individual tool. The free tool spreads through developers' terminals
and GitHub; the paid platform earns by aggregating what individual
tools cannot — team-scale history, cross-repo analytics, managed AI,
and webhook-driven automation.

This is the Open Core / Product-Led Growth model (Sentry, PostHog,
Supabase, Grafana). It works because:

1. The free tier is genuinely useful on its own — not crippled.
2. The paid tier sells things a solo developer physically cannot build
   alone (aggregation requires other people's data).
3. The code boundary is architectural, not legal — the paid part is
   valuable *because* it holds data the free part doesn't.

## The three-layer split

| Layer | Repository | License | Purpose |
|---|---|---|---|
| Runner (`sft-dev.mjs`) | `cicured/sft-runner` | MIT | The engine. Every `npx @cicured/sft` in a stranger's terminal is free distribution. |
| Local CLI (`sft`) | `cicured/sft-cli` | MIT | The product developers install on day one. Wraps the runner, adds local history, optional cloud sync. |
| Cloud SaaS | `titouhalloub/cicured` (this repo) | Proprietary | The team platform. API, worker, dashboard, AI orchestration, webhooks. |

### What stays closed (this repo)

- `apps/api/**`
- `apps/worker/**`
- `apps/web/**`
- The AI orchestration layer (`apps/worker/src/ai/**`)
- Deployment config, prompts, cache strategy, secret filter

### What gets extracted (new repos, MIT)

- `packages/runner/**` → `cicured/sft-runner`
- A new CLI wrapper → `cicured/sft-cli`

### What can be shared (MIT, already extracted)

- `packages/schemas/**` — the wire contract. Sharing it helps
  integration and costs nothing.

## Phase breakdown

### Phase 1 — Extract the runner (this phase)

Make `packages/runner` publishable as a standalone npm package.

Deliverables:
- `packages/runner/LICENSE` (MIT, copyright Reda Halloub)
- `packages/runner/README.md` — install, use, exit codes, config
- `packages/runner/package.json` with publish metadata
- `packages/runner/bin/sft.mjs` — an executable shim so `npx @cicured/sft`
  works
- No changes to `sft-dev.mjs` (the sha256 pin test must still pass)

Exit criteria:
- `pnpm -r typecheck && pnpm -r lint && pnpm -r test` all green
- `node packages/runner/bin/sft.mjs` runs the runner from the local repo
- `pnpm --filter @cicured/sft pack` produces a `.tgz` that contains only
  the four files listed under `files`

Non-goals for Phase 1: no publish to npm, no new GitHub repo. Those are
user actions (Phase 1.5).

### Phase 1.5 — Split into its own repo (user action)

- Create `github.com/titouhalloub/sft-runner`, public, MIT license
- `git subtree split -P packages/runner -b sft-runner-split`
- Push that branch to the new repo's `main`
- In this repo, add `sft-runner` as a git submodule OR keep the current
  copy and note that it will be replaced later

Note: not required to unblock later phases. Can be deferred.

### Phase 2 — Build the CLI

A thin wrapper `sft` that adds local-developer value without any cloud
dependency.

Deliverables (new repo `cicured/sft-cli`):
- `sft init` — writes a `sft.config.json` template
- `sft run` — runs the runner in a local Docker sandbox
  (`--no-sandbox` runs on the host for developers without Docker)
- `sft run --json` — structured output, MCP-ready
- `sft logs` — reads `.sft/cache.json` and prints the last N runs
- `.sft/cache.json` — local history, single developer, single machine
- BYOK for AI fixes — reads `ANTHROPIC_API_KEY` from env, calls the
  model directly, prints suggestions to the terminal
- `sft login` — mints a device token against `api.cicured.com` (opt-in)
- `sft sync` — uploads reports to the cloud (opt-in)

No server code in the CLI. Ever. The CLI is a client.

### Phase 3 — Optional cloud sync

Add the endpoints on the SaaS side that accept synced runs.

- `POST /sync/runs` — accepts a signed payload from a logged-in CLI
- Device tokens stored in a new `device_tokens` table
- Cloud-stored runs appear in the user's `/app` dashboard alongside
  webhook-triggered runs
- Rate-limited per token; account-level quotas apply

This is the flywheel: every opted-in CLI is a data source that powers
the Team tier analytics.

### Phase 4 — Publish

- `npm publish @cicured/sft` (from `sft-runner`)
- `npm publish @cicured/cli` (from `sft-cli`)
- Landing page at `cicured.com` (static, pointed at the current
  `apps/web/app/page.tsx`)
- A "Show HN" post with a real terminal recording
- README on the CLI repo explaining install/use/exit codes

### Phase 5 — The analytics layer (post-MVP)

Deferred from the current roadmap. Its own milestone document when
ready. Friction Index, Flaky Test Detection, AI Token Waste, Velocity
Degradation, AI vs Human Authorship. Requires real user data first.

## License decisions

| Artifact | License | Rationale |
|---|---|---|
| `sft-dev.mjs` runner | MIT | Maximum distribution. Fork-friendly. No legal friction. |
| `sft` CLI | MIT | Same. |
| `packages/schemas` | MIT | Wire contract. Sharing helps integration. |
| SaaS (`apps/**`) | Proprietary | Never published. Never source-available. |

**Rejected:** BSL 1.1. It's tempting for the runner, but the runner is
not the moat — the SaaS data is. MIT maximizes adoption, and adoption
is the whole point of Phase 1.

If a competitor forks the runner and hosts it as a competing service:
fine. They still need to build the SaaS layer, and by then you've moved
on to the analytics layer that requires their users' data anyway.

## What prevents "I'll self-host this"

Three layers of protection, in order:

1. **Architectural.** The valuable part is cross-team aggregation over
   months. A solo developer cannot self-host value that requires other
   people's data.
2. **License.** The SaaS is proprietary. The CLI can't self-host the
   cloud because it doesn't ship with cloud code.
3. **Economic.** A solo developer hosting a Postgres + Redis + worker +
   dashboard themselves spends a weekend maintaining it — and 20
   engineer-hours is more expensive than $29/month per seat.

## Realistic funnel numbers

| Stage | 12-month target |
|---|---|
| GitHub stars on `sft-runner` | 500–3,000 |
| Free CLI monthly active users | 5–15% of stars |
| Free → paid conversion | 1–3% |
| Paid seats at year 1 | 10–40 |
| ARR at $29/dev/mo | $3.5k–$14k |

This is a slow build. The point is that marginal cost per free user is
near zero, so the funnel can grow without burning cash.

## Success criteria for the open-core split

- The runner on npm is stable and documented
- The CLI runs in a fresh directory with zero configuration
- A developer who has never heard of cicured can go from `npx` to a
  successful run in under 5 minutes
- No SaaS code has been open-sourced accidentally
- The `sft-runner` repo's README points readers to `cicured.com` for
  team dashboards

## Non-goals

- Self-hostable SaaS. Not in MVP. If it ever happens, it will be an
  Enterprise tier and it will be a paid license.
- Feature-gating the free CLI. The free tier must be genuinely useful.
- Telemetry without consent. Cloud sync is opt-in only.

## Open questions

- Should `sft-cli` be a separate repo from `sft-runner`, or one repo
  with two packages? **Current lean:** separate, so the runner can
  evolve independently of CLI ergonomics.
- Should the CLI bundle a Docker sandbox, or require Docker? **Current
  lean:** default to Docker, allow `--no-sandbox` for devs without it.
  The sandbox is the safety story; make it the default.
- Does the CLI need Windows support in v1? **Current lean:** yes, but
  through `--no-sandbox` mode. Full sandbox support is Linux-only
  (which is fine — the CLI's target is a developer on any OS, and the
  sandbox is a Linux-container concept).