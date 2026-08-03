"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { signIn, signOut } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import {
  LOGIN_EMAIL_RULE,
  LOGIN_IP_RULE,
  SIGNUP_IP_RULE,
  checkRateLimit,
  clientIp,
  recordAttempt,
  retryMessage,
} from "@/lib/rate-limit";

// Server actions backing the login and signup forms. Both end by calling
// Auth.js `signIn`, which — on success — throws a `NEXT_REDIRECT` to the board.
// That redirect must be re-thrown (never swallowed by the AuthError catch), so
// the try/catch only handles genuine `AuthError`s and rethrows everything else.

// Shape returned to the client form via `useActionState`. `undefined` is the
// initial (no-error) state; a populated `error` is rendered under the form.
export type AuthActionState = { error: string } | undefined;


// Deliberately permissive: real validation is the server-side uniqueness check
// and the credentials `authorize` step. This just catches obvious typos early.
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function login(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  // Throttle before doing any bcrypt work — that cost is the reason these
  // endpoints are worth attacking. Two buckets: the origin IP, and the target
  // account (which still holds when an attacker spreads guesses across many IPs).
  const ipKey = `login:ip:${await clientIp()}`;
  const emailKey = `login:email:${email.toLowerCase()}`;

  const ipVerdict = await checkRateLimit(ipKey, LOGIN_IP_RULE);
  if (!ipVerdict.allowed) return { error: retryMessage(ipVerdict.retryAfterMs) };

  const emailVerdict = await checkRateLimit(emailKey, LOGIN_EMAIL_RULE);
  if (!emailVerdict.allowed) {
    return { error: retryMessage(emailVerdict.retryAfterMs) };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // Only failures are recorded. A successful sign-in throws the redirect
      // below and never reaches this branch, so normal use never accrues a
      // lockout — and the counters are not reset by guessing correctly once.
      await recordAttempt(ipKey, LOGIN_IP_RULE);
      await recordAttempt(emailKey, LOGIN_EMAIL_RULE);

      // The credentials provider returns `null` for both "no such user" and
      // "wrong password", so we surface one generic message either way.
      if (error.type === "CredentialsSignin") {
        return { error: "Invalid email or password." };
      }
      return { error: "Could not sign you in. Please try again." };
    }
    // Not an auth failure — this is the success redirect. Let it propagate.
    throw error;
  }
}

export async function signup(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!isValidEmail(email)) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  // Cap account creation per origin. Unlike login this counts every accepted
  // attempt, not just failures — the abuse being prevented is bulk signup, where
  // each "success" is the problem.
  const signupKey = `signup:ip:${await clientIp()}`;
  const signupVerdict = await checkRateLimit(signupKey, SIGNUP_IP_RULE);
  if (!signupVerdict.allowed) {
    return { error: retryMessage(signupVerdict.retryAfterMs) };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with this email already exists." };
  }

  await recordAttempt(signupKey, SIGNUP_IP_RULE);

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: name || null,
    },
  });

  try {
    // Log the new user straight in with the same credentials.
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // The account exists now; ask them to sign in manually rather than
      // leaving them stranded on the signup page.
      return { error: "Account created, but sign-in failed. Try logging in." };
    }
    throw error;
  }
}

// Sign the current user out and send them to the login page. Backs the board
// header's sign-out button (a plain form posting to this action).
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
