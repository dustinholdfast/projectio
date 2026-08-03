import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 talks to the database through a driver adapter rather than a bundled
// query engine. We connect to Postgres (Supabase in hosted environments, a local
// container in development) with the node-postgres adapter.
//
// DATABASE_URL should be a *pooled* connection string: Supabase's transaction
// pooler (port 6543) for serverless hosts, or the session pooler (5432) for a
// long-running server. Migrations use a direct connection instead — see
// prisma.config.ts, which reads DIRECT_URL.
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  // Fail loudly rather than falling back to a default. Against a remote database
  // a silent fallback would surface much later as confusing "no such table" or
  // empty-result bugs.
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and set a Postgres connection string.",
    );
  }

  // PrismaPg accepts a pg.Pool, a pg.PoolConfig, or a connection string. Passing
  // a PoolConfig lets us cap the pool: every app instance opens its own, so the
  // ceiling that matters is (instances x max) against the pooler's limit. Keep
  // this small — 1-2 on serverless, ~5 on a long-running server.
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 5),
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

// Reuse a single client across hot reloads in development. Next.js clears the
// module cache on each change, so without this a new client (and a new
// connection pool) would be created on every reload and exhaust the database's
// connection limit.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
