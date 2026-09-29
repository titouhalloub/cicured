# @sft/worker

**Empty M1 scaffold.** Spec §11 places the worker in M2; nothing may be
implemented here during M1.

- `src/` contains no M2 code. The BullMQ consumer, per-run Docker sandbox
  (non-root, read-only rootfs, tmpfs workspace, egress allowlist), credential
  broker, lockfile-aware install, pinned-runner injection, live log tee and
  exit-code handling all land in M2.
- `package.json` has no `test` script because there is nothing to test yet;
  tests ship together with the M2 implementation.

Do not start M2 from this scaffold.
