#!/usr/bin/env bash
# scripts/gate.sh — run the three workspace gate phases sequentially,
# capture each phase's exit code, exit with the first non-zero.
#
# Sequential (not parallel) — the parallel gate has shown load-induced
# flakes in the runner timing tests.
#
# Invocation:
#   bash scripts/gate.sh
#   nohup bash scripts/gate.sh >/tmp/cicured-gate.log 2>&1 &
#   setsid bash scripts/gate.sh </dev/null >/tmp/cicured-gate.log 2>&1 &
#
# Do not rely on `./scripts/gate.sh` — Windows NTFS does not carry a
# POSIX exec bit, so the file arrives mode 100644 on any clone made from
# Windows. Call it through `bash` explicitly. On the Ubuntu VM the exec
# bit can be set once locally with `chmod +x` if `./scripts/gate.sh` is
# wanted there.

set -uo pipefail

STATUS_FILE="${GATE_STATUS_FILE:-/tmp/cicured-gate.status}"
: > "$STATUS_FILE"

overall=0
for phase in typecheck lint test; do
  start=$(date +%s)
  echo "[gate] === $phase ==="
  pnpm -r "$phase"
  status=$?
  dur=$(( $(date +%s) - start ))
  printf '%s status=%d duration_s=%d\n' "$phase" "$status" "$dur" \
    | tee -a "$STATUS_FILE"
  if [ "$status" -ne 0 ] && [ "$overall" -eq 0 ]; then
    overall=$status
  fi
done

echo "[gate] summary ($STATUS_FILE):"
cat "$STATUS_FILE"
exit "$overall"
