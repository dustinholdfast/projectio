# Project/IO — Deployment Guide

How to migrate this app off SQLite onto Supabase, then get it onto real web
hosting.

Written against the code as it stands on 2026-08-03 (Next.js 15.5.22, Prisma
7.9.1, Auth.js 5.0.0-beta.32).

> **Status: the SQLite → Postgres migration in section 3 has been applied and
> verified**, along with auth rate limiting, password reset (§10.3), and
> multi-board support, card scheduling, and the card detail dialog. Verified
> locally against Postgres 17.10: migrations apply, the seed runs,
> `npm run build` succeeds, 117 unit tests pass, and all 18 Playwright end-to-end
> tests pass — board create/rename/delete, the cross-account 404, card create and
> keyboard-drag reorder with persistence, the Overdue / Due Now / Later / Paused /
> Completed schedule view, card details with checklists and dependency-cycle
> refusal, login throttling, full password recovery, and account-enumeration
> resistance.
>
> What remains before going live is infrastructure, not code: create the Supabase
> project (§4), set the environment variables (§5), and clear the deployment
> blockers in §6 that are marked *not yet done* — chiefly getting the repository
> pushed to a remote.

---

## 1. What you are deploying

| Layer | Technology | Deployment consequence |
|---|---|---|
| Framework | Next.js 15 App Router, React 19 | Needs a Node server or a Node-compatible serverless runtime |
| Mutations | Server Actions (`lib/actions/*`) | Server-side POSTs; no separate API tier |
| Auth | Auth.js v5, Credentials provider, JWT sessions | Needs `AUTH_SECRET`; no session table |
| Route guard | Edge middleware (`middleware.ts`) | Never touches the database — unaffected by this migration |
| Database | Prisma 7 → **Supabase Postgres** via `@prisma/adapter-pg` | Network connection; pooling is the thing to get right |
| Styling | Tailwind CSS v4 | Build-time only |

Data model: `User → Board → Column → Card`, ordered by a `Float position` with
midpoint inserts, plus `ChecklistItem` and a `CardBlock` join table for
dependencies. Cascading deletes throughout. Cards carry date-only `dueDate`,
`startedAt` and `completedAt` plus `pausedAt`, from which the Overdue / Due Now /
Later / Paused / Completed lanes are derived rather than stored.

### What Supabase is doing here

Supabase is being used **purely as managed Postgres**. The app keeps its own
`User` table and Auth.js credentials login — it does not use Supabase Auth,
Storage, Realtime, or the PostgREST API. That is a legitimate way to use
Supabase, and it keeps the auth code untouched. It does mean you should confirm
the auto-generated REST API is not exposing your tables; see section 10.2.

### Honest scope note

Project/IO is a **multi-account, multi-board Kanban tool**. Each account signs
up, owns as many boards as it likes, and can create, rename and delete them;
boards are private to their owner, enforced in the query rather than by a check
after loading. That is a real product surface, and it deploys as-is.

It is not yet multi-*tenant*. There are still no organizations, teams, member
roles, sharing or invitations, and no billing — so it serves individuals, not
companies. Adding those means a membership model between `User` and `Board`
(today `Board.ownerId` is a single owner), which is a schema change rather than a
UI one. Email verification is also still missing; §10.3 has the current list.

---

## 2. What moving to Supabase buys you

The SQLite build had a hard architectural ceiling. Postgres removes all of it:

| Constraint under SQLite | Status on Supabase |
|---|---|
| Serverless hosts (Vercel, Netlify, Cloudflare) impossible — ephemeral disk | **Resolved.** Vercel becomes the natural host |
| Persistent volume required, mounted at a fixed path | **Gone.** No disks to configure |
| Exactly one app instance — a volume cannot be shared | **Gone.** Scale horizontally |
| One writer at a time | **Gone.** Real concurrency |
| `better-sqlite3` native module; had to compile per platform, could not ship Windows `node_modules` | **Gone.** `pg` is pure JavaScript |
| Restart = brief outage; no zero-downtime deploys | **Resolved** |
| You own backups (cron + `sqlite3 .backup` + off-box copies) | **Managed.** Supabase does daily backups; PITR on paid plans |

The cost is one new thing to get right — **connection pooling** — covered in
section 4.

---

## 3. Code migration: SQLite → Supabase — **applied**

This section records the changes that were made, so the reasoning behind each is
available when something looks odd later. Nothing here is outstanding work.

Local development now needs a Postgres instance. The container used to verify the
migration:

```bash
docker run -d --name taskboard-pg -p 5434:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=taskboard_dev postgres:17
docker exec taskboard-pg psql -U postgres -c "CREATE DATABASE taskboard_test;"
```

Port 5434 rather than the conventional 5432/5433 because this machine already has
Postgres listening on both — if `psql` works inside the container but connections
from the host fail with `password authentication failed`, check
`netstat -ano | grep 5433` for a second listener before suspecting credentials.

### 3.1 Swap the driver adapter

`@prisma/adapter-pg@7.9.1` bundles `pg` **and** `@types/pg` as direct
dependencies, so there is nothing else to install:

```bash
npm uninstall @prisma/adapter-better-sqlite3
npm install @prisma/adapter-pg@7.9.1
```

If `better-sqlite3` was added as a direct dependency, remove that too.

### 3.2 `prisma/schema.prisma`

```prisma
datasource db {
  provider = "postgresql"
}
```

The models need no changes. `String @id @default(cuid())`, `Float position`, and
the cascade rules all port to Postgres unchanged.

### 3.3 `lib/prisma.ts`

Replace the adapter construction. Keep the hot-reload singleton exactly as it is
— it matters more with a connection pool than it did with a file handle:

```ts
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  // PrismaPg accepts a pg.Pool, a pg.PoolConfig, or a connection string.
  // PoolConfig lets us cap the pool — important behind a transaction pooler
  // and in serverless, where every instance opens its own pool.
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 5),
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

Note the change from the SQLite version: it silently fell back to
`file:./dev.db` when `DATABASE_URL` was missing. Against a remote database a
silent fallback is worse than a clear startup failure, so this throws.

### 3.4 `prisma/seed.ts`

The seed builds its own client. Apply the same swap there:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
```

### 3.5 `next.config.ts`

`serverExternalPackages` existed only to keep the SQLite native module out of
the bundle. Drop those entries:

```ts
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
};
```

If the build warns about an optional `pg-native` require, add
`serverExternalPackages: ["pg"]` back — but only if you actually see it.

### 3.6 `prisma.config.ts` — point migrations at the direct connection

Prisma 7's config supports `datasource.url` and `datasource.shadowDatabaseUrl`.
There is **no `directUrl` key** — the split is done by choosing which environment
variable the config reads. This is exactly what you want with Supabase: the CLI
runs DDL over a direct connection while the app runs queries through the pooler.

```ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a direct (non-transaction-pooled) connection.
    // The app runtime uses DATABASE_URL via the adapter in lib/prisma.ts.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
```

### 3.7 Rebuild the migration history

The old `20260802174146_init/migration.sql` was SQLite dialect (`DATETIME`,
`REAL`) and could not apply to Postgres. It was deleted and a fresh baseline
generated:

```bash
rm -rf prisma/migrations
npx prisma migrate dev --name init
```

The result is `prisma/migrations/20260803013309_init/` with
`migration_lock.toml` now recording `provider = "postgresql"`. The translation is
faithful: `position` became `DOUBLE PRECISION`, timestamps `TIMESTAMP(3)`, and
every index and `ON DELETE CASCADE` foreign key carried over. Commit this
directory.

**If you already have real data in `dev.db`**, export before deleting. The
`cuid` string ids and `Float` positions port directly, so a short script that
reads through the old SQLite client and writes through the new Postgres client
is enough — insert `User`, then `Board`, then `Column`, then `Card` so foreign
keys resolve in order.

### 3.8 Fix the end-to-end test setup

`e2e/global-setup.ts` deleted `e2e.db` and re-seeded — file operations that no
longer mean anything. It now resets a separate Postgres database named by
`E2E_DATABASE_URL`, and `playwright.config.ts` passes that same URL to the dev
server it launches. **This must never point at production** — the setup drops
every table. `.env.example` includes a local container to point it at.

Three things about this were not obvious and cost a debugging cycle each:

- **`migrate reset` does not run the seed.** Despite `migrations.seed` being
  configured in `prisma.config.ts`, Prisma 7's reset completes with zero rows.
  The setup therefore invokes `npx tsx prisma/seed.ts` explicitly afterwards.
- **`migrate reset` has no `--skip-generate` flag** in Prisma 7; passing it
  fails the command outright.
- **Playwright does not read `.env`** the way Next and the Prisma CLI do, so
  `playwright.config.ts` imports `dotenv/config` to pick up `E2E_DATABASE_URL`.

`E2E_DATABASE_URL` is required rather than defaulted, deliberately: a missing
value fails loudly instead of silently resetting whatever `DATABASE_URL` happens
to point at.

The Vitest suites (`test/`) mock `@/lib/prisma` outright, so they needed no
changes and passed throughout the migration.

### 3.9 Verification results

```bash
npx prisma migrate deploy   # applied cleanly
npm run db:seed             # dev only — see 6.2
npm run build               # ✓ 7 routes incl. /api/health
npm test                    # ✓ 27 passed
npm run test:e2e            # ✓ 3 passed
```

The reorder path was the one worth exercising, since it writes a `Float`
midpoint. Confirmed working: dragging the first card down one slot wrote
`position = 2500` between neighbours at 2000 and 3000, and the order survived a
reload. Postgres `DOUBLE PRECISION` behaves like SQLite `REAL` here.

### 3.10 Two failures worth knowing about

Both surfaced during verification and are recorded because they will recur.

**Prisma 7's migrate commands do not regenerate the client.** Neither
`migrate dev` nor `migrate reset` runs `prisma generate`, which is a change in
behaviour from earlier Prisma versions and cost a debugging cycle twice, each
time with an error that points somewhere other than the cause:

- After the provider change, the seed died with *"The Driver Adapter
  `@prisma/adapter-pg`, based on `postgres`, is not compatible with the provider
  `sqlite` specified in the Prisma schema"* — while the schema plainly said
  `postgresql`. The stale *generated client* held the old provider.
- After adding a model, the login action threw *"Cannot read properties of
  undefined (reading 'count')"* — the model existed in the schema and in the
  database, but not in the generated client.

`npx prisma generate` resolves both. `build` and `e2e/global-setup.ts` now run it
explicitly so neither path can hit this again. It is also precisely the failure
§6.4 guards against on Vercel, where a dependency-cache hit skips `postinstall`
and leaves a stale client in place.

**A latent test race only lost once the database was networked.** The reorder
e2e test drove the keyboard drag as three back-to-back keypresses and reloaded
immediately after the drop. Against a local SQLite file both worked by luck.
Against Postgres they did not, in two separate ways:

- dnd-kit commits each keyboard step to React state before accepting the next,
  so an `ArrowDown` in the same tick as the lift was discarded and the card never
  moved. The test now gates on `aria-pressed` and on dnd-kit's `role="status"`
  announcements.
- The board reorders **optimistically, before the server action resolves**, so
  the reload outran the write and re-rendered the old order — while the database
  ended up correct. The test now awaits the action's POST response before
  reloading.

The second point is worth noting as product behaviour, not just test mechanics:
a user who reloads in the instant after a drag can see the pre-drag order. The
write does land. Neither issue is a data-integrity bug, and neither was caused by
Supabase — added latency merely stopped hiding them.

---

## 4. Supabase setup and connection strings

### 4.1 Create the project

1. Create a Supabase project. Pick the region closest to where the **app** will
   run, not where you live — every query pays that round trip.
2. Save the database password somewhere safe; it appears once.
3. Dashboard → **Connect** shows the connection strings. Copy them from there
   rather than assembling them by hand; Supabase has changed these hostnames
   before.

### 4.2 Which connection string to use where

Supabase offers three, and picking wrong is the most common failure in this
setup:

| Connection | Port | Use for | Why |
|---|---|---|---|
| **Transaction pooler** | 6543 | Serverless runtime (Vercel) | Survives many short-lived instances; hands back the connection after each transaction |
| **Session pooler** | 5432 | Long-running server runtime (Render, Railway, Fly, VPS) | Full Postgres feature support, IPv4-reachable |
| **Direct** | 5432 | Migrations (`DIRECT_URL`) | DDL and advisory locks need a real session |

Two practical warnings:

- **IPv4.** Direct connections to `db.<ref>.supabase.co` are IPv6-only unless you
  buy the IPv4 add-on. Several hosts have no IPv6 outbound. If migrations fail
  to connect but the app works, this is why — use the **session pooler** string
  for `DIRECT_URL` instead of the direct one. It supports DDL fine.
- **Pool sizing.** Poolers enforce a connection ceiling per project. Every app
  instance opens its own `pg` pool, so keep `DB_POOL_MAX` small (5, or 1–2 on
  serverless) rather than letting instances multiply into the limit.

---

## 5. Environment variables

| Variable | Required | Value | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | Pooler string (6543 serverless / 5432 session) | Read at runtime by `lib/prisma.ts`. Append `?sslmode=require`. |
| `DIRECT_URL` | Yes | Direct or session-pooler string | Read by `prisma.config.ts` for migrations only. Not needed in the app's runtime environment if you migrate from CI. |
| `AUTH_SECRET` | Yes | 32+ random bytes | `npx auth secret` or `openssl rand -base64 32`. Signs the session JWT; rotating it logs everyone out. |
| `AUTH_TRUST_HOST` | Non-Vercel hosts | `true` | Auth.js v5 rejects proxied host headers without it. Not needed on Vercel. |
| `DB_POOL_MAX` | No | `5` (server), `2` (serverless) | Added in 3.3. |
| `APP_URL` | No | `https://board.example.com` | Base URL for links in outbound email. Derived from the request headers when unset, which is correct on every host here; set it only when the public URL differs from what the proxy forwards. |
| `NODE_ENV` | Auto | `production` | Set by `next start` / the platform. |

The database password is inside the connection string — treat both URLs as
secrets, set them in the host's secrets UI, and never commit `.env`
(`.gitignore` already excludes it, which is correct).

---

## 6. Pre-deployment blockers

Code-level items (6.3–6.6) are **done**. 6.1 is **not** — it needs your GitHub
account — and 6.2 is a standing rule rather than a task.

### 6.1 Get the code into a remote repository — required, NOT YET DONE

The repo has one commit (`fe891c1 Initial commit`), **no remote**, and nearly
every source directory untracked (`app/`, `lib/`, `components/`, `e2e/`,
`middleware.ts`, `.env.example`). Any git-based host would deploy an empty
project.

```bash
git add -A && git commit -m "Add application source" && git status --short
```

Confirm no `.env` or `*.db` files appear, then push to a private repo.

### 6.2 Never run the seed against production — required

`prisma/seed.ts` creates `demo@example.com` with the password `password123` and
**deletes that user's boards** on every run. Publicly reachable, with a published
password.

With SQLite this was contained to a local file. On Supabase the same command
points at a live shared database, so the blast radius is larger. Production
deploy commands must call `prisma migrate deploy` only — never `db:seed`, and
never `db:reset` or `migrate reset`, which **drop every table** and then reseed.

### 6.3 `/design` is now gated in production — DONE

`lib/auth.config.ts` previously marked `/design` public unconditionally, exposing
the internal design-system preview on a deployed site. It is now public only
outside production; in production it requires a session like any other route.
Reverse this if you would rather it stay open — it leaks no data, it is simply
not something to hand the public.

### 6.4 `prisma generate` moved into the build script — DONE

`generated/prisma/` is gitignored and produced by the `postinstall` hook. Vercel
caches `node_modules` between builds and **skips `postinstall` on a cache hit**,
yielding a stale or missing Prisma client. `build` is now
`prisma generate && next build`. See §3.10 for what that failure looks like when
it does happen — it is not self-explanatory.

### 6.5 Never install with `--omit=dev` — required knowledge

`postinstall` runs `prisma generate`, and `prisma.config.ts` imports
`dotenv/config`. Both `prisma` and `dotenv` are devDependencies, so
`npm ci --omit=dev` fails at postinstall. Always run a full `npm ci`. This also
keeps the `prisma` CLI available for `migrate deploy`.

### 6.6 Node pinned and health check added — DONE

`package.json` now declares `"engines": { "node": ">=22 <23" }` so a host cannot
silently pick Node 18.

`app/api/health/route.ts` round-trips the database with `SELECT 1` and returns
`{status:"ok"}` or a 503. Against a remote database this genuinely tests
reachability, which makes it far more useful than it was against a local file. It
is listed in `PUBLIC_PATHS` so the middleware does not redirect the health
checker, and it deliberately returns no version, connection details, or error
text. Point your host's health check at `/api/health`.

---

## 7. Deploy to Vercel (recommended)

Vercel plus Supabase is the natural pairing now that the filesystem dependency
is gone.

1. **Import the repository** from section 6.1. Vercel detects Next.js; leave the
   build settings at their defaults once 6.4 is in place.
2. **Environment variables** (Production, Preview, Development as appropriate):
   - `DATABASE_URL` → **transaction pooler** string, port 6543, `?sslmode=require`
   - `AUTH_SECRET` → generated value
   - `DB_POOL_MAX` → `2`
   - `AUTH_TRUST_HOST` is **not** needed on Vercel.
3. **Run the first migration** from your machine against production. Note the
   shell: the inline `VAR=value cmd` form is POSIX-only and fails on Windows
   with *"'DIRECT_URL' is not recognized as an internal or external command"*.
   ```bash
   # bash / zsh
   DIRECT_URL="<direct-or-session-pooler-string>" npm run db:deploy
   ```
   ```powershell
   # PowerShell — single quotes stop $ and & in the password being interpreted
   $env:DIRECT_URL = '<direct-or-session-pooler-string>'; npm run db:deploy
   ```
   The variable persists for that shell session, so a later `db:migrate` there
   would target production. Close the window, or clear it
   (`Remove-Item Env:DIRECT_URL`).
4. **Deploy.** There will be no accounts until someone signs up at `/signup`.

### Migrations on subsequent deploys

Do **not** put `prisma migrate deploy` in the Vercel build command. Every preview
deployment runs that build, so preview branches would apply migrations to your
production database. Two safe options:

- **Manual** (fine for a solo project): run the command in step 3 when a
  migration ships.
- **CI**, on merges to `main` only:
  ```yaml
  - run: npx prisma migrate deploy
    env:
      DIRECT_URL: ${{ secrets.DIRECT_URL }}
  ```

If you want previews to have their own schema, look at Supabase branching rather
than pointing them at production.

### The serverless caveat worth knowing

Each Vercel instance constructs its own `pg` pool, and `lib/prisma.ts`
deliberately does not cache the client in production. Under a traffic spike,
instance count multiplies by `DB_POOL_MAX` against the pooler's ceiling. The
transaction pooler is what makes this workable — but keep `DB_POOL_MAX` at 1–2,
and if you see connection exhaustion, that is the first knob.

---

## 8. Alternative hosts

All of these got simpler with the SQLite dependency gone: no volumes, no
single-instance pinning, no native compilation.

**Render / Railway** — Node web service:
- Build: `npm ci && npm run build`
- Start: `npm run start`
- Env: `DATABASE_URL` (**session** pooler, 5432), `AUTH_SECRET`,
  `AUTH_TRUST_HOST=true`, `DB_POOL_MAX=5`
- No disk to attach. Multiple instances are now fine.

**Fly.io** — `fly launch`, `fly secrets set ...`, same variables. No volume, and
you can scale past one machine.

**Docker / VPS** — the Dockerfile is much simpler than the SQLite version;
`pg` is pure JavaScript, so no build toolchain is required:

```dockerfile
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# Full install: postinstall runs `prisma generate` (needs the prisma CLI and
# dotenv, both devDependencies). See §6.5.
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
```

```bash
docker run -d --name taskboard -p 3000:3000 \
  -e DATABASE_URL="<session-pooler-string>" \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_TRUST_HOST=true \
  --restart unless-stopped taskboard
```

Front it with Caddy for automatic TLS:

```
board.example.com {
    reverse_proxy localhost:3000
}
```

**HTTPS is not optional** — Auth.js issues `__Secure-` prefixed session cookies
in production, and passwords are posted in plain form fields.

Migrations are a deliberate step here too: `npx prisma migrate deploy` with
`DIRECT_URL` set, run from CI or by hand. Putting it in `CMD` means every
container restart races the others to take the migration lock.

---

## 9. Post-deployment verification

On the live URL:

1. `GET /login` renders over HTTPS with a valid certificate.
2. `GET /` while signed out redirects to `/login` — the middleware guard is live.
3. Sign up a real account at `/signup`; you land on `/` with the empty state.
4. Create a board — you should be taken straight into it — then add a column and
   a card. Reload; everything persists. Go back to `/` and confirm the tile shows
   the right column/card counts.
5. Drag a card to another column, reload, confirm the new position held. This
   exercises the server action → adapter → Postgres write path end to end.
6. Sign up a *second* account and paste the first account's `/board/[id]` URL
   into it. It must 404 — not redirect, and not render the board.
7. Sign out, sign back in, confirm the data is still there.
8. **Redeploy or restart**, then reload. Data must survive — with an external
   database it will, which is precisely the improvement over SQLite.
9. Confirm `demo@example.com` / `password123` does **not** log in.
10. Enter a wrong password six times for one account. The sixth attempt must
   return "Too many attempts" rather than "Invalid email or password" — this
   confirms the limiter sees a real client IP through your host's proxy, which is
   the part that cannot be verified locally.
11. Request a password reset. Until you wire up an email provider (§10.3) the
    link appears in your host's **server logs**, not an inbox — check there, open
    it, and confirm the new password works and the link is refused on reuse. The
    link's host must be your real domain; if it is not, set `APP_URL`.
12. In the Supabase dashboard, check **Database → Roles/Connections** for
    connection count under normal use. If it is near the ceiling at low traffic,
    lower `DB_POOL_MAX`.

---

## 10. Operations

### 10.1 Backups

Supabase takes daily backups on all paid plans; point-in-time recovery is a paid
add-on. Two things worth doing anyway:

- Enable PITR if this data would be painful to lose.
- Keep an independent copy — a provider-managed backup you have never restored
  is a hypothesis. `pg_dump "$DIRECT_URL" > backup.sql` on a schedule, stored
  off-platform, and **restored once into a scratch project** to prove it works.

### 10.2 Verify the REST API is not exposing your tables

Supabase auto-generates a PostgREST API over the `public` schema. Tables created
by Prisma migrations are owned by the migration role and are **not** granted to
the `anon` / `authenticated` roles, so they should not be readable with the
public anon key. Confirm rather than trust it:

```bash
curl "https://<project-ref>.supabase.co/rest/v1/User" \
  -H "apikey: <anon-key>"
```

Anything other than an empty result or a permission error means your user table
is world-readable — fix it immediately by enabling RLS on all four tables:

```sql
ALTER TABLE "User"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Board"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Column" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Card"   ENABLE ROW LEVEL SECURITY;
```

With no policies attached, RLS denies everything to non-owning roles. Your app
connects as the owning role and is unaffected — authorization stays in the
server actions, where it already works correctly.

### 10.3 Security posture

**Rate limiting — DONE.** `lib/rate-limit.ts` throttles both credential actions
before any bcrypt work happens. Sliding-window counters live in the `AuthAttempt`
table rather than in memory, so they survive serverless instances and cannot be
evaded by spreading requests across them. Rules: failed logins 10/15min per IP,
failed logins 5/15min per email, signups 5/hour per IP. Only failures count
against the login rules, so ordinary use never accrues a lockout. Verified end to
end in `e2e/rate-limit.spec.ts`.

Two operational notes:

- IP bucketing trusts `x-forwarded-for`, which is safe only because every host in
  §7–8 overwrites it at the edge. If you ever expose this app directly, that
  header becomes attacker-controlled and only the per-email rule still holds.
- `AuthAttempt` rows are pruned per key as they age out of the window, so the
  table stays bounded without a scheduled job.

**Ownership checks — solid.** Every action in `lib/actions/board.ts` re-reads the
session and walks the board relationship before writing, so a forged id cannot
touch another account's data. This is what makes the RLS measure in §10.2
belt-and-braces rather than load-bearing.

**Password reset — DONE, with one thing left for you.** The full flow works:
`/forgot-password` → emailed link → `/reset-password` → sign in. Tokens are
stored only as SHA-256 hashes, expire after an hour, are single-use, and are
invalidated when a newer one is issued. No response reveals whether an account
exists — the request form answers identically either way, every token failure
returns one message, and requests for unregistered addresses are rate limited
too, so the limiter cannot be used as an existence oracle. Verified end to end in
`e2e/password-reset.spec.ts`.

**The one thing left: wire up an email provider.** `lib/mailer.ts` is a
one-method interface with only a console transport, so reset links currently go
to the *server log* rather than a user's inbox. That is fine for staging and
makes the flow fully testable, but it is not account recovery for real users —
and anyone with log access can take over an account that requests a reset. The
file documents exactly what to implement (a Resend example is included); it
warns once at runtime in production so the state is visible rather than silent.
Do this before inviting anyone who is not you.

**Still open:**

- **No email verification.** Anyone can sign up with any address, including one
  they do not control. Needs the same email provider.
- **No audit logging.** `AuthAttempt` records failures for throttling but is
  pruned, so it is not an audit trail.

### 10.4 Dependency notes

- `next-auth@5.0.0-beta.32` is a beta pin. Do not float it; test deliberately
  before bumping.
- `npm audit` reports 3 high advisories in Next.js's bundled `postcss`/`sharp`.
  Per `AGENTS.md`, the only offered "fix" downgrades Next to v9 — a breaking
  regression — so they are left as-is. Re-check on each Next minor upgrade.
- Keep `prisma`, `@prisma/client`, and `@prisma/adapter-pg` on the **same
  version** (7.9.1 today). Mismatches surface as confusing adapter errors.

### 10.5 Pre-deploy checks

```bash
npm run build && npm test && npm run test:e2e
```

The Playwright suite needs `E2E_DATABASE_URL` pointing at a throwaway database
(section 3.8) and `npx playwright install chromium` once per machine. It covers
the flows in section 9 steps 3–5, plus the login throttle.

---

## 11. Quick reference

```bash
# Local production rehearsal against a dev Supabase project (bash / zsh)
npm ci
DIRECT_URL="<direct-string>" npm run db:deploy
npm run build
DATABASE_URL="<pooler-string>" AUTH_SECRET="$(openssl rand -base64 32)" npm run start
```

```powershell
# Same, in PowerShell
npm ci
$env:DIRECT_URL = '<direct-string>'; npm run db:deploy
npm run build
$env:DATABASE_URL = '<pooler-string>'
# Cryptographic RNG, not Get-Random — this value signs session tokens.
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:AUTH_SECRET = [Convert]::ToBase64String($bytes)
npm run start
```

| Host | Runtime | `DATABASE_URL` | `AUTH_TRUST_HOST` |
|---|---|---|---|
| **Vercel** | Serverless | Transaction pooler, 6543 | Not needed |
| Render / Railway | Long-running Node | Session pooler, 5432 | `true` |
| Fly.io | Long-running Node | Session pooler, 5432 | `true` |
| VPS + Docker + Caddy | Long-running Node | Session pooler, 5432 | `true` |

Migrations always use `DIRECT_URL` (direct connection, or the session pooler if
your host has no IPv6), and always run as a deliberate step — never from the
Vercel build command, never from a container `CMD`.
