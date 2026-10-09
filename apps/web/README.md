# @sft/web

The cicured dashboard — Next.js 15 (App Router) + React 19 + Tailwind CSS v4
+ shadcn/ui, talking to `apps/api` over cookie-based sessions (Spec §11).

## Running

```bash
pnpm --filter @sft/web dev     # http://localhost:3000
```

The API must be running on :4000 first (`pnpm --filter @sft/api dev`), or the
data queries will fail. The browser is redirected to `/login` without the
`sft_session` cookie (see `middleware.ts`).

| Command | Purpose |
|---|---|
| `pnpm --filter @sft/web dev` | dev server on :3000 |
| `pnpm --filter @sft/web build` | production build |
| `pnpm --filter @sft/web start` | serve the production build |
| `pnpm --filter @sft/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @sft/web lint` | `eslint .` (shared flat config) |
| `pnpm --filter @sft/web test` | `vitest run` |

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Public URL of the API. Every fetch goes through `lib/api.ts` with `credentials: "include"`, so the httpOnly session cookie is sent automatically — JS never reads it. |

## Structure

- `app/(app)/` — authenticated shell (sidebar + topbar) with Dashboard, Runs,
  run detail and Projects pages.
- `app/(auth)/login/` — centered sign-in hero ("Sign in with GitHub" hands off
  to `${NEXT_PUBLIC_API_URL}/auth/github`).
- `middleware.ts` — presence-only cookie gate; real auth happens when the API
  answers 401.
- `lib/api.ts` — typed fetch wrapper (`ApiError`, 401 redirect).
- `lib/queries.ts` — TanStack Query hooks (runs/projects).

## Design language

Horizon UI-inspired — see `apps/web/app/globals.css` for the token set
(`--color-brand-primary: #4318FF`, surface/card/text tokens, `--radius-card`).
Dark mode is first-class: `next-themes` toggles the `.dark` class, persisted
to localStorage key `cicured-theme`. Typography is DM Sans via `next/font`.

