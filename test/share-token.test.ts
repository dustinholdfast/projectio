import { describe, expect, it } from "vitest";

import {
  createShareToken,
  hashShareToken,
  isPlausibleShareToken,
  shareTokenPrefix,
} from "@/lib/share-token";

describe("share tokens", () => {
  it("creates a 256-bit URL-safe token and a stable SHA-256 digest", () => {
    const token = createShareToken();

    expect(isPlausibleShareToken(token)).toBe(true);
    expect(hashShareToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashShareToken(token)).toBe(hashShareToken(token));
    expect(hashShareToken(token)).not.toContain(token);
  });

  it("keeps only a short non-secret management prefix", () => {
    const token = createShareToken();
    expect(shareTokenPrefix(token)).toBe(token.slice(0, 8));
  });

  it.each(["", "short", "x".repeat(42), "x".repeat(44), "?".repeat(43)])(
    "rejects malformed capability input %s",
    (token) => expect(isPlausibleShareToken(token)).toBe(false),
  );
});
