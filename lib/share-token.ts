import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_PREFIX_LENGTH = 8;

/** Create a 256-bit URL-safe capability token. */
export function createShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Store and look up only this digest; the raw token is shown once. */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Non-secret identifier that lets an owner distinguish managed links. */
export function shareTokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX_LENGTH);
}

/** Reject malformed or oversized input before doing a database lookup. */
export function isPlausibleShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
