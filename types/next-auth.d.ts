import type { DefaultSession } from "next-auth";

// Augment Auth.js's types so `session.user.id` (set in the session callback) is
// typed everywhere we read the session. `id` is the Prisma User cuid.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
