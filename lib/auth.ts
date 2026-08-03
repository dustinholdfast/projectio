import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";

// Node-runtime Auth.js config.
//
// Extends the edge-safe base (lib/auth.config.ts) with the Credentials
// provider, whose `authorize` step talks to Prisma and bcrypt — both Node-only,
// so this module must never be imported by the Edge middleware. It exports the
// handlers/helpers the rest of the app uses:
//   - `handlers`      → mounted by app/api/auth/[...nextauth]/route.ts
//   - `auth`          → read the session in Server Components / route handlers
//   - `signIn`/`signOut` → server-action entry points for the login/logout flows
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      // These fields drive Auth.js's default form, but our own login page
      // (later card) posts email + password to the same endpoint.
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
        });
        // No such user, or a legacy row without a hash → deny. (Returning null
        // signals "invalid credentials" without leaking which check failed.)
        if (!user?.passwordHash) return null;

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) return null;

        // The returned object is persisted into the JWT (see the `jwt`
        // callback). Never include the password hash.
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Persist the user id onto the token so it survives across requests...
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    // ...and expose it on `session.user.id` for server-side ownership checks.
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
