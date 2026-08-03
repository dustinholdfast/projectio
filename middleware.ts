import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Route protection runs in Edge middleware, so it uses only the edge-safe base
// config (no Prisma/bcrypt). The `authorized` callback in authConfig decides
// which requests are allowed; unauthenticated hits on protected paths are
// redirected to the sign-in page.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on every path except Next.js internals, the Auth.js API routes, and
  // static assets. Anything not matched here is served without the guard.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
