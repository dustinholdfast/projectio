# Project/IO

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
  `AuthAttempt` (rate-limit ledger) and `PasswordResetToken` — both described
  under Authentication below.
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
- **Password reset** (`lib/password-reset.ts` + `lib/actions/password-reset.ts`,
  pages `/forgot-password` and `/reset-password`, both in `PUBLIC_PATHS`).
  - Only the SHA-256 *hash* of a token is stored, so a database dump cannot be
    turned into account takeovers. Tokens last one hour, are single-use, and
    issuing a new one marks the account's outstanding tokens used.
  - Redemption is claimed with a conditional `updateMany` on `usedAt: null`, so
    two concurrent submissions of the same link cannot both succeed.
  - **No response may reveal whether an account exists.** The request form
    returns one confirmation either way, every token failure (unknown, expired,
    spent) returns one message, and reset requests are rate limited for unknown
    addresses too — counting only real ones would make the limiter an
    account-existence oracle. Preserve all of this when editing.
  - Resetting does not sign the user in: holding the link does not prove account
    ownership until they can also use the new password.
- **Email** (`lib/mailer.ts`) is a one-method `Mailer` interface with only a
  console transport; no provider is wired up, and `lib/mailer.ts` documents how
  to add one. In production without a provider, reset links land in the server
  log and `getMailer()` warns once. The console transport also mirrors messages
  to `MAIL_OUTBOX_PATH` when set — a test-only seam the e2e suite uses to read
  the link it was sent. Nothing sets that variable outside `playwright.config.ts`.
- `MIN_PASSWORD_LENGTH` lives in `lib/password-policy.ts`, not in an actions
  module: a `"use server"` file may export only async functions, so a plain
  constant exported from one is a build error.
- Login/signup pages are built in the following cards; this card wires only the
  provider, route handler, and route protection.

## Boards

- **Two screens.** `/` (`app/page.tsx`) lists every board the user owns;
  `/board/[id]` (`app/board/[id]/page.tsx`) is one board. Both are protected
  Server Components. `/` is the post-login/signup landing route.
- `getUserBoards()` (`lib/board.ts`) returns summaries ordered by `updatedAt`
  desc, with column/card totals from `_count` aggregates rather than by loading
  every card. `getBoardForUser(id)` returns one board with columns (`position`
  asc = left→right) each with their cards (`position` asc = top→bottom).
- **Ownership is part of the query, not a check on the result.**
  `getBoardForUser` filters on `{ id, ownerId }`, so another account's board is
  indistinguishable from a missing one and the page `notFound()`s either way — it
  must never confirm that someone else's board exists. `renameBoard` and
  `deleteBoard` use `updateMany`/`deleteMany` scoped by `ownerId` for the same
  reason: a forged id matches zero rows instead of hitting another user's data.
- Mutations are server actions in `lib/actions/board.ts`: `createBoard` (creates
  then `redirect`s into the new board), `renameBoard`, `deleteBoard` (cascades to
  columns and cards; the UI confirms first), `createColumn`, `createCard`, and
  the two reorder actions. Board names are trimmed and capped at 80 chars.
- **Revalidate through `revalidateBoard(boardId)`**, which refreshes both
  `/board/[id]` and `/` — the list shows per-board counts, so a card write
  changes it too. Do not reintroduce a bare `revalidatePath("/")`.
- Inline UIs are client components in `components/board/` (`add-card-form`,
  `add-column-form`, `create-board-form`, `board-settings`). They compose the
  `@/components/ui` primitives and call the actions; editors use `useTransition`
  and close only once the action returns without an error. `AppHeader`
  (`components/app-header.tsx`) is the shared signed-in chrome and carries the
  wordmark, which links back to the list. `signOutAction` (`lib/actions/auth.ts`)
  backs its sign-out button.

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
  `test/password-reset.test.ts` covers `lib/password-reset.ts` with `@/lib/prisma`
  mocked (hash-only storage, expiry, single-use claiming, prior-token
  invalidation, and identical reporting of every failure mode).
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
  failures, then refusal — including of the *correct* password).
  `e2e/password-reset.spec.ts` runs the whole recovery flow: request a link, read
  it from the mail outbox, redeem it, confirm the link is then single-use, the
  old password is dead and the new one works — plus that an unregistered address
  gets the same confirmation and no mail. Both specs create their own accounts
  rather than touching `demo@example.com`, so they cannot lock out or mutate what
  the board specs rely on; keep it that way.
  `e2e/boards.spec.ts` covers the list, create → rename → delete, and the
  cross-account boundary (another user's board URL must 404).
- **Navigate with `gotoReady()` (`e2e/helpers.ts`), not `page.goto()`, whenever a
  click follows.** `next dev` compiles routes on demand and serves HTML before
  the JavaScript is ready; a click landing in that window submits the form
  natively, without the header Next needs to recognise a server action, so the
  action never runs and the page re-renders unchanged — no error, no navigation,
  just a test that times out much later on something unrelated. Only the first
  test to reach a route pays it, which makes it look like a flake belonging to
  whichever spec runs first.
- Assertions on inline errors should scope to the form
  (`page.locator("form").getByRole("alert")`): Next's dev overlay also exposes a
  `role="alert"` node, so an unscoped query hits a strict-mode violation.
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
