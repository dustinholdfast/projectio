import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";

// Sliding-window rate limiting for the credential auth endpoints.
//
// Both `login` and `signup` are server actions that run a bcrypt comparison or
// hash — expensive by design, which makes them a brute-force target and a cheap
// denial-of-service vector. This module caps how often a given bucket (client IP,
// or email address) may attempt them.
//
// State lives in the `AuthAttempt` table rather than in memory: the app is meant
// to run on serverless or multi-instance hosting, where an in-process counter
// would be per-instance and trivially evaded by spreading requests around.

export type RateLimitRule = {
  /** Attempts permitted inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

const MINUTE = 60_000;

/**
 * Failed logins from one IP. The looser of the two login rules: several people
 * behind one office NAT should not lock each other out.
 */
export const LOGIN_IP_RULE: RateLimitRule = { limit: 10, windowMs: 15 * MINUTE };

/**
 * Failed logins against one email address, regardless of origin — this is the
 * rule that actually blunts a distributed password-guessing attack on a known
 * account.
 */
export const LOGIN_EMAIL_RULE: RateLimitRule = { limit: 5, windowMs: 15 * MINUTE };

/** Account creations from one IP, to stop bulk signup abuse. */
export const SIGNUP_IP_RULE: RateLimitRule = { limit: 5, windowMs: 60 * MINUTE };

export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

/**
 * Client IP for rate-limit bucketing.
 *
 * `x-forwarded-for` is client-supplied and therefore spoofable in general; it is
 * trustworthy only because every deployment target in DEPLOYMENT.md (Vercel,
 * Render, Railway, Fly, or nginx/Caddy) overwrites it at the edge. If this app
 * is ever exposed directly to the internet without such a proxy, this value
 * becomes attacker-controlled and IP bucketing stops being meaningful — the
 * per-email rule is the one that still holds in that case.
 *
 * Falls back to a single shared bucket when no header is present. That is
 * deliberately conservative: an unknown origin is rate limited, not exempt.
 */
export async function clientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headerList.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Report whether `key` is under its limit, without consuming budget.
 *
 * Reading and recording are separate so that only *failures* count against the
 * login rules: a successful sign-in redirects out of the action before any
 * attempt is recorded, so ordinary use never accumulates a lockout.
 */
export async function checkRateLimit(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitVerdict> {
  const windowStart = new Date(Date.now() - rule.windowMs);

  const count = await prisma.authAttempt.count({
    where: { key, createdAt: { gte: windowStart } },
  });
  if (count < rule.limit) return { allowed: true };

  // Blocked. The window reopens when the oldest attempt still inside it ages
  // out, so report that rather than the full window length.
  const oldest = await prisma.authAttempt.findFirst({
    where: { key, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const retryAfterMs = oldest
    ? Math.max(0, oldest.createdAt.getTime() + rule.windowMs - Date.now())
    : rule.windowMs;

  return { allowed: false, retryAfterMs };
}

/**
 * Record one attempt against `key`, and prune that key's rows that have aged out
 * of the window. Pruning here keeps the table bounded without a scheduled job;
 * auth attempts are low-volume enough that the extra delete is not worth
 * avoiding.
 */
export async function recordAttempt(
  key: string,
  rule: RateLimitRule,
): Promise<void> {
  await prisma.authAttempt.create({ data: { key } });
  await prisma.authAttempt.deleteMany({
    where: { key, createdAt: { lt: new Date(Date.now() - rule.windowMs) } },
  });
}

/**
 * User-facing copy for a blocked attempt. Rounds up to whole minutes, and never
 * promises "0 minutes".
 */
export function retryMessage(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / MINUTE));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
