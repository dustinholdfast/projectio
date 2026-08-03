# TestProject

Project conventions and context for AI coding agents.

This file is the canonical context for every AI coding agent working in
this project. CLAUDE.md and GEMINI.md point here. Keep it current.

Planning artifacts live in .castforge/ (plan.md, research.md, decisions.md, ui-spec.md, verification.md); peer work-logs live in .castforge/roles/. Read them before starting work.

## Stack

- Next.js 15 (App Router) + React 19
- TypeScript (strict), path alias `@/*` → project root
- Tailwind CSS v4 (via `@tailwindcss/postcss`; configured in `app/globals.css`)
- Prisma 7 + Postgres (via the `@prisma/adapter-pg` driver adapter) — Supabase in
  hosted environments, a local Docker container in development
- Auth.js v5 (`next-auth@5`) — credentials provider, JWT sessions

## Conventions

- App Router lives in `app/`. Global styles in `app/globals.css`.
- Use the `@/*` import alias for project-root modules.
- Coder builds structure/behavior with minimal styling; Designer owns final
  presentation.

## Design system

- Direction + token/component reference: `.castforge/ui-spec.md`. Live preview
  at `/design` (`app/design/page.tsx`).
- Design tokens are CSS variables in `app/globals.css`, exposed as semantic
  Tailwind utilities (`bg-card`, `text-muted-foreground`, `border-border`,
  `bg-primary`, `bg-label-*`, `rounded-lg`, `shadow-md`). Consume tokens — do
  not hardcode hex in screens. Dark mode is class-based (`.dark` on `<html>`).
- Reusable primitives live in `components/ui` (Button, Input, Label, Card,
  Badge); import from `@/components/ui`. Compose these instead of one-off markup.
  `cn()` (`@/lib/utils`, clsx + tailwind-merge) merges/overrides classes.

## Database (Prisma + Postgres)

- Schema: `prisma/schema.prisma`. Config: `prisma.config.ts` (loads `.env` via
  `dotenv`). Template in `.env.example`.
- Two connection strings, deliberately separate:
  - `DATABASE_URL` — **pooled**, read at runtime by the adapter in `lib/prisma.ts`.
  - `DIRECT_URL` — **direct**, read only by the Prisma CLI via `prisma.config.ts`,
    because DDL and the migration advisory lock need a real session. Prisma 7's
    config has no `directUrl` key; the split is made by choosing which variable
    the config reads. Falls back to `DATABASE_URL` locally.
- Prisma 7 uses the new `prisma-client` generator; the client is generated to
  `generated/prisma/` (gitignored) and regenerated on `postinstall`.
- **Prisma 7's migrate commands do not run `prisma generate`.** Neither
  `migrate dev` nor `migrate reset` regenerates the client, so after any schema
  change you must run `npx prisma generate` yourself. Skipping it produces two
  misleading errors: a provider change surfaces as *"driver adapter … not
  compatible with the provider `sqlite`"* even though the schema plainly says
  otherwise, and a new model surfaces as *"Cannot read properties of undefined"*
  on a model that plainly exists. `build` and `e2e/global-setup.ts` both run
  `prisma generate` explicitly to stay immune to this (and `build` needs it
  anyway, since Vercel skips `postinstall` on a dependency-cache hit).
- No bundled query engine: the app connects through the `@prisma/adapter-pg`
  driver adapter, which bundles `pg` and `@types/pg` as direct dependencies —
  they do not need to be installed separately. `pg` is pure JavaScript, so no
  `serverExternalPackages` entry is required.
- Import the shared client from `@/lib/prisma` (hot-reload-safe singleton). Do
  not `new PrismaClient()` in app code. The singleton matters more with a
  connection pool than it did with a file handle: pool size is capped by
  `DB_POOL_MAX` (default 5), and the ceiling that matters is instances × that.
- Local development runs Postgres in Docker; see `.env.example` for the
  container and connection strings.
- Domain models: `User` → `Board` → `Column` → `Card` (single-user Kanban), plus
  the standalone `AuthAttempt` (rate-limit ledger, see Authentication below).
  `User` carries credential-auth fields (`email` unique, `passwordHash`).
  `Column`/`Card` ordering uses a `Float position` per sibling set — a row
  dropped between two neighbors takes the midpoint of their positions, so a
  reorder writes only the moved row. Relations cascade on delete
  (user→boards→columns→cards).
- Migrations live in `prisma/migrations/` (committed). `npm run db:seed` runs
  `prisma/seed.ts` via `tsx`. Note that Prisma 7's `migrate reset` does **not**
  run the `migrations.seed` command from `prisma.config.ts` — reset completes
  with zero rows — so anything needing seed data must invoke the seed explicitly
  (see `e2e/global-setup.ts`). `migrate reset` also has no `--skip-generate` flag
  in Prisma 7. The seed is idempotent and creates a demo user + populated board —
  login `demo@example.com` / `password123` (bcrypt hash).
- **The seed is development/test only.** It creates a well-known account with a
  published password and deletes that user's boards on every run. Never point it,
  `db:reset`, or `migrate reset` at a hosted database. See `DEPLOYMENT.md` §6.2.

## Authentication (Auth.js v5)

- Credential auth via `next-auth@5`. Config is split so the Edge middleware
  never pulls in Node-only deps:
  - `lib/auth.config.ts` — edge-safe base: JWT session strategy, `pages.signIn`
    = `/login`, and the `authorized` route guard. No providers.
  - `lib/auth.ts` — Node-runtime config: adds the Credentials provider whose
    `authorize` looks the user up via `@/lib/prisma` and verifies the password
    with `bcrypt.compare` against `passwordHash`. Exports `handlers`, `auth`,
    `signIn`, `signOut`. `jwt`/`session` callbacks put the User cuid on
    `session.user.id` for server-side ownership checks.
- Endpoints are mounted at `/api/auth/*` by
  `app/api/auth/[...nextauth]/route.ts` (re-exports `handlers`).
- `middleware.ts` runs the guard on every path except `api/auth`, Next static
  assets, and `favicon.ico`. Public paths (no session needed): `/login`,
  `/signup`, `/design`. Everything else redirects unauthenticated users to
  `/login`; signed-in users are bounced off `/login` and `/signup`.
- Read the session in server code with `import { auth } from "@/lib/auth"`.
  `session.user.id` is typed via `types/next-auth.d.ts`.
- `AUTH_SECRET` (in `.env`, template in `.env.example`) signs the session JWT —
  required in every environment. Generate with `npx auth secret`.
- **Rate limiting** (`lib/rate-limit.ts`) guards both credential actions, since
  each runs a bcrypt hash/compare and is therefore both brute-forceable and a
  cheap DoS vector. Sliding-window counters live in the `AuthAttempt` table, not
  in memory, so they hold across serverless instances. Three rules: failed logins
  per IP (10/15min), failed logins per email (5/15min — the one that blunts a
  distributed attack on a known account), and signups per IP (5/hour).
  - Checking and recording are deliberately separate: only *failures* count
    against the login rules, so a successful sign-in never accrues a lockout.
  - Blocked attempts are refused before any password check, so a correct password
    is rejected too while throttled. That is intended.
  - IP bucketing reads `x-forwarded-for`, which is trustworthy only because every
    supported host overwrites it at the edge. Exposed without such a proxy, the
    header is attacker-controlled and only the per-email rule still holds.
- Login/signup pages are built in the following cards; this card wires only the
  provider, route handler, and route protection.

## Board view

- The board is the app root `/` (`app/page.tsx`) — a protected Server Component
  and the post-login/signup landing route. It loads the signed-in user's board
  via `getCurrentUserBoard()` (`lib/board.ts`), which scopes to `session.user.id`
  and returns columns (ordered by `position` asc = left→right) each with their
  cards (`position` asc = top→bottom). Returns `null` when the user has no board
  (e.g. a fresh signup) — the page then shows an empty state to create one.
- Mutations are server actions in `lib/actions/board.ts`: `createBoard`,
  `createColumn`, `createCard`. Each re-reads the session, verifies the target
  (board, or column→board) belongs to the current user before writing, appends
  the new sibling at `max(position) + 1000`, and `revalidatePath("/")`. They
  return a `{ error }` state for inline display.
- Inline create UIs are client components in `components/board/`
  (`add-card-form`, `add-column-form`, `create-board-form`). They compose the
  `@/components/ui` primitives and call the actions; card/column editors use
  `useTransition` so they clear/close on success. `signOutAction`
  (`lib/actions/auth.ts`) backs the header's sign-out button.
- This card built structure + behavior with minimal styling; drag-drop
  reordering (`@dnd-kit`), reorder persistence, and the final restyle are
  separate downstream cards in this phase.

## Commands

- `npm install` — install dependencies (runs `prisma generate` via postinstall)
- `npm run dev` — start the dev server (http://localhost:3000)
- `npm run build` — production build (also runs type + lint checks)
- `npm run start` — serve the production build
- `npm run lint` — ESLint (`next/core-web-vitals` + `next/typescript`)
- `npm run db:generate` — regenerate the Prisma client
- `npm run db:migrate` — create/apply a dev migration (`prisma migrate dev`)
- `npm run db:seed` — seed the database with a demo user + board
- `npm run db:reset` — drop, re-apply migrations, and re-seed (destructive)
- `npm run db:studio` — open Prisma Studio
- `npm test` — run unit/integration tests once (Vitest); `npm run test:watch` to watch
- `npm run test:e2e` — run end-to-end browser tests (Playwright)

## Testing

- **Unit/integration (Vitest, `test/`):** config in `vitest.config.ts` (Node
  environment, `@/*` alias mirrors tsconfig). `test/reorder.test.ts` covers the
  pure ordering/reorder logic in `lib/reorder.ts` (the `position` midpoint scheme
  and the drag-drop `plan*` functions — the same gestures the UI applies).
  `test/board-actions.test.ts` covers the `reorderCard`/`reorderColumn` server
  actions with `@/lib/auth`, `@/lib/prisma`, and `next/cache` mocked (ownership
  walk, cross-board rejection, neighbor scoping, midpoint write).
  `test/rate-limit.test.ts` covers `lib/rate-limit.ts` with `@/lib/prisma` and
  `next/headers` mocked (window scoping, the read/record split, retry-time
  reporting, pruning, and `x-forwarded-for` parsing).
- **Reorder logic lives in `lib/reorder.ts`** (pure, framework-free) so it is
  testable in isolation; `components/board/board-view.tsx` only wires DnD events
  → `plan*` → optimistic state + persist, and `lib/actions/board.ts` reuses the
  same `midpointPosition`/`POSITION_STEP`.
- **End-to-end (Playwright, `e2e/`):** `playwright.config.ts` launches `next dev`
  on port 3100 against a dedicated Postgres database given by `E2E_DATABASE_URL`,
  which `e2e/global-setup.ts` resets and seeds so runs never touch the dev
  database. That variable is **required** and the setup **drops every table** in
  it — point it at a throwaway container, never at dev or a hosted database.
  Playwright does not read `.env` on its own, so the config imports
  `dotenv/config`. Tests cover login → seeded board, card create + persist, and a
  keyboard-drag card reorder that persists across reload. Cards/columns expose
  `data-testid` (`board-card` / `board-column`) + `data-card-title` /
  `data-column-name` hooks. Chromium: `npx playwright install chromium`.
  `e2e/rate-limit.spec.ts` drives the login throttle for real (5 generic
  failures, then refusal — including of the *correct* password). It creates and
  throttles its own account rather than `demo@example.com`, so it cannot lock out
  the other specs; keep it that way.
- **Two timing rules the reorder e2e test depends on**, both of which a networked
  database makes unforgiving: dnd-kit keyboard steps (lift → arrow → drop) must
  each be awaited before the next — the test gates on `aria-pressed` and on
  dnd-kit's `role="status"` announcements — and the board updates optimistically
  *before* the server action resolves, so anything asserting persistence must
  await the action's POST response before reloading. Do not replace either with a
  fixed sleep.

## Notes

- `next.config.ts` pins `outputFileTracingRoot` to this project to avoid Next.js
  picking up a stray parent-directory lockfile.
- Deployment (Supabase + hosting options, environment variables, pre-deploy
  checklist, known security gaps) is documented in `DEPLOYMENT.md`.
- `npm audit` reports 3 high advisories in Next.js's bundled `postcss`/`sharp`;
  the only "fix" downgrades Next to v9 (a breaking regression), so they are left
  as-is. They do not affect local dev.
