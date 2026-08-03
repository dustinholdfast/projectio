// Fails if any application table is missing row-level security.
//
// Exists because of a real miss: the lockdown migration enabled RLS on the six
// tables that existed when it was written, and two tables added a migration later
// silently went without. They were still protected by the revoked grants, but by
// one lock instead of two — and nothing would have told us.
//
// Run with `npm run db:check-rls` against whichever database DATABASE_URL points
// at. Worth running against production after a schema change, not just locally:
// the whole point is to catch a table that exists somewhere it should not be
// unprotected.

import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Prisma's own bookkeeping table is excluded deliberately. It holds migration
 * names and checksums rather than user data, and the migration engine writes to
 * it through connections we do not control — enabling RLS there risks breaking
 * deploys to protect nothing.
 */
const EXEMPT = new Set(["_prisma_migrations"]);

async function main() {
  const rows = await prisma.$queryRaw<
    { relname: string; relrowsecurity: boolean }[]
  >`
    SELECT relname, relrowsecurity
    FROM pg_class
    WHERE relkind = 'r'
      AND relnamespace = 'public'::regnamespace
    ORDER BY relname
  `;

  const checked = rows.filter((row) => !EXEMPT.has(row.relname));
  const unprotected = checked.filter((row) => !row.relrowsecurity);

  for (const row of checked) {
    console.log(`${row.relrowsecurity ? "ok  " : "FAIL"}  ${row.relname}`);
  }

  if (unprotected.length > 0) {
    console.error(
      `\n${unprotected.length} table(s) without row-level security: ` +
        `${unprotected.map((r) => r.relname).join(", ")}\n` +
        `Add "ALTER TABLE \\"<name>\\" ENABLE ROW LEVEL SECURITY;" to a migration.\n` +
        `See prisma/migrations/20260803163600_enable_rls for the reasoning.`,
    );
    process.exit(1);
  }

  console.log(`\nAll ${checked.length} tables have row-level security enabled.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
