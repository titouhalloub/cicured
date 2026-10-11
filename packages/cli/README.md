# @cicured/cli

A local build runner that wraps [`@cicured/sft`](https://www.npmjs.com/package/@cicured/sft)
and adds an optional AI fix stage. Run your Type Check, Lint, Build and Tests
in one command, get a machine-readable `sft-report.json`, and optionally ask
Claude to propose a patch for whatever broke. This is the free, open-source
CLI behind [cicured](https://cicured.com).

## Install

    npx @cicured/cli

Or globally:

    npm install -g @cicured/cli

## Commands

| Command | What it does |
|---|---|
| `sft run [--json] [--no-cache]` | Run the build pipeline; `--json` prints only the report, `--no-cache` skips history |
| `sft logs [--limit N]` | Show recent local runs (default 10) from `.sft/cache.json` |
| `sft init` | Write a starter `sft-dev.config.json` |
| `sft suggest` | Ask Claude to fix the most recent failure |
| `sft login` | Sign in to cicured.com (Phase 3) |
| `sft sync` | Upload local history (Phase 3) |

## Graph-aware commands (BYOK)

After `sft run`, the last `sft-report.json` in the current directory
is parsed into findings. `sft graph` builds a code graph of the repo,
cached at `.sft/graph.json`.

- `sft explain <n>` — a plain-English explanation of finding #n,
  with caller/callee/test context from the graph.
- `sft fix <n>` — a schema-validated unified diff for finding #n,
  plus a confirmation prompt before applying.

Both require `ANTHROPIC_API_KEY`. Nothing is sent to cicured — the
key is used directly against the Anthropic API (BYOK).

## Bring your own key

`sft suggest` never talks to the network unless **you** supply a key:

    export ANTHROPIC_API_KEY=sk-ant-...

No account, no cicured backend, no telemetry. Set `SFT_LLM_MODEL` to override
the default model (`claude-sonnet-4-5`). The suggestion is printed to your
terminal — it is never written to a file and never auto-applied.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All tasks passed (or a read-only command succeeded) |
| 1 | One or more tasks failed, or the command could not run |
| 2 | Runner crash — an operational error, not a task failure |

## Local data

Two files, both local, both plain JSON:

- `.sft/cache.json` — last 50 runs in the current repo (skip with `--no-cache`)
- `~/.cicured/credentials` — written `0600` on Unix, only once `sft login` ships

## License

MIT — see LICENSE.
