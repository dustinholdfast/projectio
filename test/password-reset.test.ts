import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for reset-token handling. Prisma is mocked so we can assert the
// hashing, expiry, single-use, and invalidation rules without a database.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    passwordResetToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  RESET_TOKEN_TTL_MS,
  consumeResetToken,
  generateToken,
  hashToken,
  issueResetToken,
  safeEqual,
  verifyResetToken,
} from "@/lib/password-reset";

beforeEach(() => {
  vi.resetAllMocks();
  prismaMock.passwordResetToken.create.mockResolvedValue({});
  prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
});

describe("hashToken", () => {
  it("is deterministic, so it can be looked up by index", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("differs for different tokens", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("produces a hex sha256 digest", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("generateToken", () => {
  it("is URL-safe", () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken));
    expect(tokens.size).toBe(50);
  });
});

describe("issueResetToken", () => {
  it("stores only the hash, never the raw token", async () => {
    const raw = await issueResetToken("u1");

    const data = prismaMock.passwordResetToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashToken(raw));
    expect(JSON.stringify(data)).not.toContain(raw);
  });

  it("invalidates the account's outstanding tokens first", async () => {
    await issueResetToken("u1");

    const call = prismaMock.passwordResetToken.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ userId: "u1", usedAt: null });
    expect(call.data.usedAt).toBeInstanceOf(Date);
  });

  it("sets an expiry one TTL ahead", async () => {
    const before = Date.now();
    await issueResetToken("u1");

    const { expiresAt } = prismaMock.passwordResetToken.create.mock.calls[0][0].data;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + RESET_TOKEN_TTL_MS - 50);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + RESET_TOKEN_TTL_MS + 50);
  });
});

describe("verifyResetToken", () => {
  const live = {
    id: "t1",
    userId: "u1",
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
  };

  it("accepts a live token and looks it up by hash", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(live);

    const result = await verifyResetToken("raw-token");

    expect(result).toEqual({ valid: true, userId: "u1", tokenId: "t1" });
    expect(prismaMock.passwordResetToken.findUnique.mock.calls[0][0].where).toEqual({
      tokenHash: hashToken("raw-token"),
    });
  });

  it("rejects an empty token without querying", async () => {
    expect(await verifyResetToken("")).toEqual({ valid: false });
    expect(prismaMock.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an unknown token", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(null);
    expect(await verifyResetToken("nope")).toEqual({ valid: false });
  });

  it("rejects an already-used token", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      ...live,
      usedAt: new Date(),
    });
    expect(await verifyResetToken("raw")).toEqual({ valid: false });
  });

  it("rejects an expired token", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      ...live,
      expiresAt: new Date(Date.now() - 1),
    });
    expect(await verifyResetToken("raw")).toEqual({ valid: false });
  });

  it("reports every failure identically, leaking nothing about which links existed", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(null);
    const unknown = await verifyResetToken("a");
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      ...live,
      expiresAt: new Date(Date.now() - 1),
    });
    const expired = await verifyResetToken("b");

    expect(unknown).toEqual(expired);
  });
});

describe("consumeResetToken", () => {
  it("claims a token conditionally on it still being unused", async () => {
    await consumeResetToken("t1");

    const call = prismaMock.passwordResetToken.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "t1", usedAt: null });
  });

  it("reports success when it claimed the row", async () => {
    prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    expect(await consumeResetToken("t1")).toBe(true);
  });

  it("reports failure when another request already claimed it", async () => {
    // The losing half of a double submission: zero rows matched `usedAt: null`.
    prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    expect(await consumeResetToken("t1")).toBe(false);
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
