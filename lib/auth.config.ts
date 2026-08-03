import type { NextAuthConfig } from "next-auth";

// Edge-safe base Auth.js config.
//
// This half of the config is imported by `middleware.ts`, which runs on the
// Edge runtime and therefore cannot pull in Prisma or bcrypt (native/Node-only
// deps). It holds everything the middleware needs — session strategy, custom
// pages, and the `authorized` route guard — but declares NO providers. The
// Credentials provider (which does the Node-only password check) is added in
// `lib/auth.ts`, the Node-runtime half used by the route handler and server code.

// Paths reachable without a session. Everything else requires login. The
// Auth.js API routes (`/api/auth/*`) are always allowed by the library itself.
// `/api/health` is included so platform health checks are not redirected to the
// sign-in page. It exposes only a liveness status, never data.
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/api/health",
  // Account recovery is by definition reachable without a session.
  "/forgot-password",
  "/reset-password",
];

function isPublicPath(pathname: string): boolean {
  // `/design` is the internal design-system preview. It is public outside
  // production so the team can browse it without a session, but it is not
  // something to expose on a deployed site — in production it requires a login
  // like any other route.
  if (
    process.env.NODE_ENV !== "production" &&
    (pathname === "/design" || pathname.startsWith("/design/"))
  ) {
    return true;
  }
  return PUBLIC_PATHS.includes(pathname);
}

export const authConfig = {
  // Credentials auth requires the JWT session strategy (no database sessions).
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Runs in middleware for every matched request. Return `true` to allow,
    // `false` to redirect unauthenticated users to the `signIn` page.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const onPublicPath = isPublicPath(nextUrl.pathname);

      // Signed-in users have no business on the login/signup pages — bounce
      // them to the board.
      if (isLoggedIn && (nextUrl.pathname === "/login" || nextUrl.pathname === "/signup")) {
        return Response.redirect(new URL("/", nextUrl));
      }

      // Public paths are always allowed; protected paths need a session.
      if (onPublicPath) return true;
      return isLoggedIn;
    },
  },
  // Providers are supplied by the Node-runtime config (lib/auth.ts).
  providers: [],
} satisfies NextAuthConfig;
