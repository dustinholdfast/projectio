import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/prisma";

// Token handling for the "forgot password" flow.
//
// The raw token travels in the emailed link and is never persisted; the database
// holds only its SHA-256 hash, so a database dump cannot be turned into account
// takeovers. Lookup is by hash, which is an indexed equality match rather than a
// scan — a plain HMAC comparison over every row would not scale and is not
// needed, because the hash is of a 256-bit random value, not of a guessable
// secret.

/** How long a reset link stays valid. Short: the flow is "check your mail now". */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Bytes of entropy in the raw token. 32 bytes = 256 bits. */
const TOKEN_BYTES = 32;

/** Hash a raw token for storage/lookup. Deterministic, so it can be indexed. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Generate a URL-safe random token. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Constant-time string comparison, used where a mismatch would otherwise be
 * observable through timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Issue a reset token for `userId` and return the raw value for the email link.
 *
 * Any outstanding tokens for the account are marked used first, so requesting a
 * new link invalidates the previous one — otherwise every link ever sent would
 * stay live until it expired.
 */
export async function issueResetToken(userId: string): Promise<string> {
  const now = new Date();

  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: now },
  });

  const rawToken = generateToken();
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashToken(rawToken),
      userId,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
    },
  });

  return rawToken;
}

export type TokenCheck =
  | { valid: true; userId: string; tokenId: string }
  | { valid: false };

/**
 * Look up a raw token and report whether it may still be redeemed.
 *
 * Unknown, expired, and already-used tokens are all reported identically: the
 * caller shows one message for every failure, so a probe cannot learn which
 * links once existed.
 */
export async function verifyResetToken(rawToken: string): Promise<TokenCheck> {
  if (!rawToken) return { valid: false };

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record) return { valid: false };
  if (record.usedAt) return { valid: false };
  if (record.expiresAt.getTime() <= Date.now()) return { valid: false };

  return { valid: true, userId: record.userId, tokenId: record.id };
}

/**
 * Mark a token spent. Conditional on it still being unused, so two concurrent
 * submissions of the same link cannot both succeed — the second updates zero
 * rows and is rejected by the caller.
 */
export async function consumeResetToken(tokenId: string): Promise<boolean> {
  const result = await prisma.passwordResetToken.updateMany({
    where: { id: tokenId, usedAt: null },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}
