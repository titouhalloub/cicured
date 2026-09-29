# @sft/web

M1 placeholder package. **The Next.js app is deferred to M4** (Spec §11: the
dashboard - runs list, live SSE logs, findings, diff view, feedback buttons - is
M4 scope).

- `src/index.ts` exports `WEB_M1_STUB` so `typecheck`, `lint` and `test` have a
  target without pulling React/Next into M1.
- No `next`, `react`, `react-dom`, `@types/react*` or Next config/types are
  installed in M1. They return in M4 together with the `@sft/schemas` contracts
  the UI consumes, and Tailwind (§3) lands with the UI as well.
- Keeping the package present means the workspace, the shared ESLint config and
  `pnpm -r typecheck|lint|test` cover all six packages from day one.
