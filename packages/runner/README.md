# @cicured/sft

A sandboxed build runner. Runs Type Check, Lint, Build, and Tests in
one command, writes a machine-readable `sft-report.json`, and exits
with a code your CI can branch on.

This is the free, open-source engine behind [cicured](https://cicured.com) —
a paid team platform for build-failure diagnosis and AI-generated
fixes. The runner works standalone. No account required.

## Install

    npx @cicured/sft

Or globally:

    npm install -g @cicured/sft

## Use

From the root of any Node/TypeScript repo:

    sft

The runner auto-detects tasks from your `package.json`:

- `tsconfig.json` present → Type Check (`tsc --noEmit --pretty false`)
- ESLint config present → Lint (`eslint . --no-color`)
- `scripts.build` present → Build (`npm run build`)
- `scripts.test` present → Tests (`npm test`), with `--passWithNoTests`
  for jest/vitest

Override with a `sft-dev.config.json` at the repo root:

    {
      "tasks": [
        { "name": "Type Check", "command": "pnpm -r typecheck" },
        { "name": "Lint",       "command": "pnpm -r lint" },
        { "name": "Build",      "command": "pnpm -r build" },
        { "name": "Tests",      "command": "pnpm -r test" }
      ]
    }

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All tasks passed |
| 1 | One or more tasks failed (task failures are normal; CI should branch on this) |
| 2 | Runner crash — an operational error, not a task failure |

## Report

`sft-report.json` is written to the current directory on every run:

    {
      "tool": "sft-dev",
      "version": 2,
      "finishedAt": "2026-01-01T00:00:00.000Z",
      "runnerError": null,
      "warnings": [],
      "summary": {
        "total": 4, "passed": 3, "failed": 1, "skipped": 0,
        "totalDurationMs": 13451
      },
      "tasks": [
        { "name": "Type Check", "command": "...", "success": true },
        { "name": "Lint",       "command": "...", "success": false }
      ]
    }

The JSON schema is stable and versioned (`version: 2`). Machine
consumers should read `tool` and `version` before parsing further.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `SFT_TASK_TIMEOUT_MS` | `600000` (10 min) | Per-task timeout |
| `SFT_DEADLINE_MS` | `720000` (12 min) | Total run deadline |

## Security

The runner scrubs `GIT_*`, `GITHUB_*`, `GITLAB_*`, `GH_*`, `GL_*`
from the environment before running any user task. It never reads
repository credentials. It writes one file: `sft-report.json`.

When used through cicured's cloud platform, the runner executes
inside a hardened Docker sandbox (read-only rootfs, non-root,
no-new-privileges, tmpfs workspace). Standalone use runs the runner
on your machine with your permissions — the sandbox is a platform
feature, not a runner feature.

## License

MIT — see LICENSE.
