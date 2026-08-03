import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

import { MAIL_OUTBOX_PATH } from "../playwright.config";

// Reset the e2e database to the deterministic seed state (demo user + "Product
// Roadmap" board) before the suite runs. `prisma migrate reset` drops every
// table and re-applies the committed migrations — the Postgres equivalent of the
// old delete-the-SQLite-file step.
//
// The seed is then invoked explicitly. Prisma 7's `migrate reset` does NOT run
// the `migrations.seed` command from prisma.config.ts (verified: reset completes
// with zero rows), so relying on that hook would leave the suite testing an
// empty board.
//
// DESTRUCTIVE. E2E_DATABASE_URL must point at a throwaway database — a local
// container, or a dedicated Supabase project. Never dev, never production. It is
// required rather than defaulted precisely so a missing value fails here instead
// of silently resetting whatever DATABASE_URL happens to be set to.
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E_DATABASE_URL is not set. Point it at a throwaway Postgres database — " +
        "the e2e suite drops every table in it. See .env.example.",
    );
  }

  // Override both: DATABASE_URL for the seed's adapter, DIRECT_URL for the CLI's
  // migration connection. An existing process.env value wins over .env, so this
  // targets the e2e database rather than the developer's own.
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };

  // Regenerate first. Prisma 7's migrate commands do NOT run `prisma generate`
  // (neither `migrate dev` nor `migrate reset` — and `migrate reset` has no
  // --skip-generate flag to suggest otherwise), so a schema change followed
  // straight by an e2e run would otherwise hit the stale client as
  // "Cannot read properties of undefined" on a model that plainly exists.
  execSync("npx prisma generate", { stdio: "inherit", env });
  execSync("npx prisma migrate reset --force", { stdio: "inherit", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });

  // Start each run with an empty outbox so the password-reset spec cannot read a
  // link left behind by a previous run.
  rmSync(MAIL_OUTBOX_PATH, { force: true });
}
