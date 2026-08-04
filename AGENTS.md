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
- Domain models: `User` → `Board` → `Column` → `Card`, with `ChecklistItem` and
  the `CardBlock` join table hanging off `Card`, plus `AuthAttempt` (rate-limit
  ledger) and `PasswordResetToken` — described under Authentication below.
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
- **Every table needs row-level security.** Supabase publishes the `public`
  schema through PostgREST, so a table without RLS is one stray `GRANT` from
  being world-readable. Any migration that adds a table must also
  `ALTER TABLE "<name>" ENABLE ROW LEVEL SECURITY;` — this was missed once
  already, when ChecklistItem and CardBlock were added after the lockdown
  migration. `npm run db:check-rls` fails on any unprotected table; run it after
  a schema change, and against production, not just locally.
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
- **Email** (`lib/mailer.ts`) is a one-method `Mailer` interface with two
  transports, chosen by configuration: Resend when both `RESEND_API_KEY` and
  `EMAIL_FROM` are set, otherwise a console transport that writes to the server
  log and warns once in production. A *half*-configured provider deliberately
  falls back rather than calling Resend with an undefined sender and failing
  every send at request time.
  - `send` throws on failure by design — a transport that swallowed errors would
    make "delivered" and "vanished" indistinguishable. Callers decide what that
    means.
  - **`requestPasswordReset` must catch it.** Only a real account reaches the
    send call, so an unhandled failure would answer the question the whole flow
    refuses to answer: unknown addresses would get the confirmation while
    registered ones got an error page. It logs and returns the same generic
    response. `test/password-reset-action.test.ts` asserts all three outcomes are
    identical; do not "improve" this by surfacing send errors to the user.
  - The Resend call carries a 10s `AbortSignal.timeout`: without it a stalled
    provider holds the server action open and turns slow mail into slow pages. The console transport also mirrors messages
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
### Card details

- Clicking a card opens `components/board/card-dialog.tsx`. It holds every field
  that does not belong on the card face: owner, category, priority, due/started/
  completed dates, description, notes, a checklist, and a blocked-by list.
- **Owner is free text, not a `User` relation.** Boards are single-owner with no
  sharing, so a relation would point every card at the same account. It becomes a
  relation when teams exist — do not "fix" it before then.
- **Description and Notes are different things.** Description is the short
  summary rendered on the card face; Notes is long-form and never leaves the
  dialog. Keep that split, or the board stops being scannable.
- **Deleting a card cascades** to its checklist items and to its dependency
  links in *both* directions — so it silently unblocks anything waiting on it.
  That consequence is invisible from the card being deleted, which is why the
  confirm counts the dependents and says so. `deleteCard` scopes the delete by
  owner in the query itself rather than relying on the preceding lookup.
- The detail fields save as one form; the checklist and blocker lists save on
  each interaction. That split is deliberate: the former are edited together and
  a per-field autosave would fire a request per keystroke in Notes, while each of
  the latter is already a discrete decision with nothing to cancel back to.
- Checkbox ticks are optimistic (`useOptimistic`). Without it the box stays
  visually unchanged until the server round-trip lands, which reads as a broken
  control rather than a slow one.
- `completedAt` before `startedAt` is rejected rather than stored — the usual
  cause is a typo, and accepting it would corrupt any future cycle-time figure.
- **Dependencies: `lib/card-blocks.ts` is pure so cycle detection is testable.**
  A cycle that reaches the database cannot be undone through the UI — every card
  in the loop refuses to move and no screen shows the loop. `checkBlockAllowed`
  rejects self-links, duplicates, cross-board links, and anything closing a
  cycle; `dependsOn` walks iteratively with a visited set, so a long chain will
  not overflow the stack and pre-existing bad data terminates instead of hanging.
- The card face counts only *unfinished* blockers: once a blocker is done the
  card is no longer waiting on anything. Tests that assert on the blocked badge
  must not use a blocker another test completes.

### Scheduling (Overdue / Due Now / Later / Paused / Completed)

- `/board/[id]?group=due` swaps the columns for four derived lanes. The choice
  lives in the URL (`components/board/group-toggle.tsx`) so it survives a reload
  and can be shared; anything other than `due` falls back to columns.
- **The lane is derived, never stored.** `lib/due-status.ts` is the single source
  of the rules — `dueStatusOf` for reading, `scheduleForStatus` for its inverse —
  and it is pure so the boundaries are testable without a clock or a database.
  Do not add a `status` column: it would let a card claim "Overdue" while holding
  a future date.
- Rules, highest precedence first: **Completed** wins over everything (finished
  work must never report as late), then **Paused** (parked work should stop
  nagging), then the date. No due date means Later — unscheduled is not late.
- Completing a card un-pauses it: "parked" and "finished" are different answers
  to "why is nobody working on this", and only one can be current. Dragging a
  card out of Completed clears `completedAt`.
- `Card.dueDate` is `@db.Date` — a due date is a *day*, not an instant. Read it
  with `dayKeyOfDueDate` (UTC components, since `@db.Date` returns midnight UTC);
  read "today" with `dayKeyOfInstant` (local components). Mixing the two shifts
  the day for anyone behind UTC. **Known limitation:** "today" is the *server's*
  day, so the Overdue boundary moves at the server's midnight. Set `TZ` on the
  host; a real fix needs a per-user timezone.
- **Overdue is a drag source but not a drop target** (`DUE_STATUS_DROPPABLE`).
  Nothing coherent can be meant by dropping a card into it — lateness is what
  time does to a card. The server action rejects it too, not just the UI.
- Dragging to Later *clears* the due date rather than inventing a future one;
  pausing *keeps* it so resuming restores the original schedule.
- Cards in the schedule view are plain `useDraggable`, not sortables: `position`
  is per-column, so there is nowhere to persist an order within a derived lane
  and offering one would be a lie. They sort by due date, soonest first.
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
- **The e2e database is shared across the whole run and seeded once.** A spec that
  mutates a seeded card changes what later specs see — completing a card moved it
  out of the lane `due-status.spec` asserts on, failing a spec that had nothing
  wrong with it. Create your own card (or account) when a test mutates state that
  another spec reads.
  `e2e/boards.spec.ts` covers the list, create → rename → delete, and the
  cross-account boundary (another user's board URL must 404).
  `e2e/card-details.spec.ts` covers the detail dialog: saving fields, the
  start/complete date validation, completion moving a card to the Completed lane,
  the checklist, blocking including the refused cycle, and delete with its
  consequence warning.
  `e2e/due-status.spec.ts` covers the schedule view: the toggle, seeded cards
  landing in the lane their date implies, Overdue refusing drops, and pause →
  resume round-tripping through a reload.
- **Navigate with `gotoReady()` (`e2e/helpers.ts`), not `page.goto()`, whenever a
  click follows**, and `waitForLanding()` after a sign-in click. `next dev` compiles routes on demand and serves HTML before
  the JavaScript is ready; a click landing in that window submits the form
  natively, without the header Next needs to recognise a server action, so the
  action never runs and the page re-renders unchanged — no error, no navigation,
  just a test that times out much later on something unrelated. Only the first
  test to reach a route pays it, which makes it look like a flake belonging to
  whichever spec runs first.
- Assertions on inline errors should scope to the form
  (`page.locator("form").getByRole("alert")`): Next's dev overlay also exposes a
  `role="alert"` node, so an unscoped query hits a strict-mode violation.
- The suite runs against `next dev` in a OneDrive-synced directory, so first-hit
  route compilation is occasionally *very* slow — the per-test timeout is 90s for
  that reason, and a lone timeout on the first test of a run is usually the
  machine, not the code. Re-run before investigating.
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
