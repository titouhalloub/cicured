#!/bin/bash
# SFT-Dev sandbox entrypoint - one container per run (Spec §2, §8).
#
# Contract with the worker (apps/worker/src/sandbox/launcher.ts):
#   in  : GIT_REPO_URL GIT_BRANCH GIT_TOKEN SFT_DEADLINE_MS SFT_TASK_TIMEOUT_MS
#   out : the pinned runner's exit code (0 all tasks passed, 1 task failures,
#         2 runner crash) - `exec` makes it the container's exit code
#   file: /workspace/repo/sft-report.json, written by the runner in its cwd
#
# The runner is bind-mounted read-only at /opt/sft/sft-dev.mjs by the worker.
# It is never copied from the user's repo and never installed here.
set -euo pipefail

WORKSPACE=/workspace
REPO_DIR="$WORKSPACE/repo"
RUNNER=/opt/sft/sft-dev.mjs
# Used only when the worker did not pass SFT_DEADLINE_MS (runner's own default).
DEADLINE_BUDGET_FALLBACK_MS=720000
# Spec §2 pre-flight: deadline = 15 min budget - install wall-time - 60 s.
DEADLINE_RESERVE_MS=60000
# The runner ignores non-positive SFT_DEADLINE_MS values (it falls back to its
# own 12 min default), so never hand it a non-positive deadline.
MIN_DEADLINE_MS=1000

log() { printf '[sandbox] %s\n' "$*"; }
# Exit 2 == "runner crash" for the worker: a bootstrap failure is operational,
# never a task failure, so the report must not be parsed (Spec §2).
die() { printf '[sandbox] fatal: %s\n' "$*" >&2; exit 2; }
require_env() { [ -n "${!1:-}" ] || die "$1 is required"; }

# ── 1. Writable paths ──────────────────────────────────────────────────────
# The root filesystem is read-only and /workspace is a tmpfs, so every cache
# that would normally land in $HOME has to be redirected into the tmpfs.
export HOME="$WORKSPACE"
export XDG_CACHE_HOME="$WORKSPACE/.cache"
export COREPACK_HOME="$WORKSPACE/.corepack"
# Corepack would otherwise block on "Do you want to continue? [Y/n]" when it
# downloads the package manager pinned by the repo's packageManager field.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export npm_config_cache="$WORKSPACE/.npm"
export PNPM_HOME="$WORKSPACE/.pnpm"
export YARN_CACHE_FOLDER="$WORKSPACE/.yarn"
# Never block waiting for git credentials - the token is in the URL below.
export GIT_TERMINAL_PROMPT=0

require_env GIT_REPO_URL
require_env GIT_BRANCH
require_env GIT_TOKEN

# Millisecond wall clock. EPOCHREALTIME is a bash >= 5 builtin; busybox `date`
# does not implement `%3N`, and `date +%s` alone is too coarse for a fast
# install.
epoch_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    local digits="${EPOCHREALTIME/./}"
    echo $((10#${digits:0:${#digits} - 3}))
  else
    echo "$(($(date +%s) * 1000))"
  fi
}

# ── 2. Clone (Spec §4 step 5) ──────────────────────────────────────────────
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"
# TODO(M2b): use `git -c http.extraheader="Authorization: Bearer $GIT_TOKEN"`
# instead of embedding the token in the URL. Acceptable for M2a (1h TTL,
# single-purpose container); not acceptable once we tee logs to Redis.
git clone --depth 1 --branch "$GIT_BRANCH" \
  "https://x-access-token:$GIT_TOKEN@$GIT_REPO_URL" repo
cd "$REPO_DIR"

# ── 3. Lockfile-aware install (Spec §2 worker pre-flight) ───────────────────
install_started_ms="$(epoch_ms)"
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile
elif [ -f package-lock.json ]; then
  npm ci
elif [ -f yarn.lock ]; then
  yarn install --frozen-lockfile
else
  npm install
fi
install_ms=$(( $(epoch_ms) - install_started_ms ))

# ── 4. Runner deadline (Spec §0: 15 min - install - 60 s) ───────────────────
budget_ms="${SFT_DEADLINE_MS:-$DEADLINE_BUDGET_FALLBACK_MS}"
deadline_ms=$(( budget_ms - install_ms - DEADLINE_RESERVE_MS ))
if [ "$deadline_ms" -lt "$MIN_DEADLINE_MS" ]; then
  deadline_ms="$MIN_DEADLINE_MS"
fi
export SFT_DEADLINE_MS="$deadline_ms"
log "install=${install_ms}ms deadline=${deadline_ms}ms budget=${budget_ms}ms"

# ── 5. Scrub credentials before any user code runs (Spec §8) ───────────────
# Defence in depth: the runner scrubs the same prefixes itself, but the clone
# is the only thing that needs the token.
while IFS='=' read -r name _; do
  case "$name" in
    GIT_* | GITHUB_* | GITLAB_* | GH_* | GL_*) unset "$name" ;;
  esac
done < <(env)

# ── 6. Run the pinned runner ────────────────────────────────────────────────
# `exec` replaces this shell, so the runner's exit code becomes the container's.
cd "$REPO_DIR"

# The runner's exit code must survive to the container, but `set -e` (line 12)
# would abort this script the moment `node` returns non-zero - which is the
# NORMAL outcome for a failing build (exit 1). So capture it without tripping
# errexit, copy the report out, then exit with it.
runner_exit=0
node "$RUNNER" || runner_exit=$?

# Copy the report out of tmpfs before the container exits: after that,
# /workspace is unmounted and the file is gone. Best-effort - if the
# runner crashed before writing a report, the worker classifies the run
# by exit code alone.
if [ -f "$REPO_DIR/sft-report.json" ]; then
  cp "$REPO_DIR/sft-report.json" /out/sft-report.json 2>/dev/null || true
fi

exit "$runner_exit"
