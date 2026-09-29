# @sft/runner

`sft-dev.mjs` is the **pinned** machine interface (Spec §2). It is injected by the
worker into the sandbox at `/opt/sft/sft-dev.mjs` — never taken from the user's repo.

## Pinning rule (`.clinerules`)

> `packages/runner/sft-dev.mjs` is pinned: do not modify it without adding/adjusting its tests.

`test/runner.spec.ts` contains a sha256 pin test. If the runner is intentionally
upgraded:

1. Replace `sft-dev.mjs` with the new artifact (keep the file byte-identical to the
   released source — no local edits, no reformatting).
2. Update the `PINNED_SHA256` constant in `test/runner.spec.ts` **and** the contract
   tests for any behaviour change.
3. Note the change in the run/spec changelog (Spec §15 pattern).

## Contract covered by tests

- exit `0` all tasks passed, exit `1` task failures (normal), exit `2` runner crash
- per-task timeout (10 min default, `SFT_TASK_TIMEOUT_MS`) → task `timedOut`, exit code `124`
- global deadline (`SFT_DEADLINE_MS`, 12 min default) → remaining tasks `skipped`
  with `global deadline exceeded`, run exits `1`
- `sft-dev.config.json` override: invalid entries ignored with a warning, fully
  invalid config falls back to auto-detection
- token scrubbing: `GIT_*` / `GITHUB_*` / `GITLAB_*` / `GH_*` / `GL_*` are removed
  from the environment before task processes start
- additive report fields: `task.skipped`, `task.truncated`, `report.warnings`,
  `report.runnerError` (schema stays v2)

> Note: on Windows the pinned runner's timeout uses a best-effort `child.kill()`
> (no process group). Tests assert the runner's *reported semantics*; the Docker
> sandbox in M2 is the real enforcement boundary.
