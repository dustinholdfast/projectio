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
  prisma: PrismaClientInstance | undefined;
};

type PrismaClientInstance = ReturnType<typeof createPrismaClient>;

let client: PrismaClientInstance | undefined;

function getClient(): PrismaClientInstance {
  if (!client) {
    client = globalForPrisma.prisma ?? createPrismaClient();
    if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  }
  return client;
}

/**
 * The shared client — constructed on first *use*, not on import.
 *
 * The laziness is load-bearing, not a micro-optimisation. `next build` imports
 * every module while collecting page data, so an eagerly-constructed client made
 * the build itself require DATABASE_URL. That failed the first Vercel deploy with
 * "Failed to collect page data for /api/health", which points at the route rather
 * than at the real cause. A build should not need production database
 * credentials; only a request should.
 *
 * Behaviour is otherwise unchanged: a missing DATABASE_URL still throws the same
 * clear error, just at the first query instead of at import.
 *
 * Functions are bound to the client so destructured or template-tag calls
 * (`prisma.$queryRaw\`...\``) keep their receiver.
 */
export const prisma = new Proxy({} as PrismaClientInstance, {
  get(_target, property, receiver) {
    const value = Reflect.get(getClient(), property, receiver);
    return typeof value === "function" ? value.bind(getClient()) : value;
  },
});
