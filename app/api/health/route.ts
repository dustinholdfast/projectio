import { prisma } from "@/lib/prisma";

// Liveness/readiness probe for the hosting platform. Unlike a plain "is the port
// open" check, this round-trips the database, so it fails when the app is up but
// its Postgres connection is not — the failure mode worth restarting for.
//
// Public by design (see PUBLIC_PATHS in lib/auth.config.ts) and deliberately
// leaks nothing: no version, no connection details, no error text.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "degraded" }, { status: 503 });
  }
}
