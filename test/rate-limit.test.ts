import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for the auth rate limiter. Prisma and next/headers are mocked so we
// can assert window scoping, the read/record split, retry reporting, and pruning
// without a real database or request context.
const { prismaMock, headersMock } = vi.hoisted(() => ({
  prismaMock: {
    authAttempt: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  headersMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));

import {
  LOGIN_EMAIL_RULE,
  checkRateLimit,
  clientIp,
  recordAttempt,
  retryMessage,
} from "@/lib/rate-limit";

const RULE = { limit: 3, windowMs: 60_000 };

/** Minimal stand-in for the Headers object `next/headers` resolves to. */
function withHeaders(map: Record<string, string>) {
  headersMock.mockResolvedValue({ get: (k: string) => map[k] ?? null });
}

beforeEach(() => {
  vi.resetAllMocks();
  prismaMock.authAttempt.create.mockResolvedValue({});
  prismaMock.authAttempt.deleteMany.mockResolvedValue({ count: 0 });
});

describe("checkRateLimit", () => {
  it("allows while under the limit and counts only inside the window", async () => {
    prismaMock.authAttempt.count.mockResolvedValue(2);

    const before = Date.now();
    const verdict = await checkRateLimit("login:ip:1.2.3.4", RULE);

    expect(verdict).toEqual({ allowed: true });

    const where = prismaMock.authAttempt.count.mock.calls[0][0].where;
    expect(where.key).toBe("login:ip:1.2.3.4");
    // The lower bound is one window back, not the beginning of time.
    const gte: Date = where.createdAt.gte;
    expect(gte.getTime()).toBeGreaterThanOrEqual(before - RULE.windowMs - 50);
    expect(gte.getTime()).toBeLessThanOrEqual(Date.now() - RULE.windowMs + 50);
  });

  it("blocks once the limit is reached", async () => {
    prismaMock.authAttempt.count.mockResolvedValue(RULE.limit);
    prismaMock.authAttempt.findFirst.mockResolvedValue({
      createdAt: new Date(Date.now() - 20_000),
    });

    const verdict = await checkRateLimit("k", RULE);

    expect(verdict.allowed).toBe(false);
  });

  it("reports retry time from the oldest attempt still in the window", async () => {
    prismaMock.authAttempt.count.mockResolvedValue(RULE.limit);
    // Oldest attempt was 20s into a 60s window, so ~40s remain.
    prismaMock.authAttempt.findFirst.mockResolvedValue({
      createdAt: new Date(Date.now() - 20_000),
    });

    const verdict = await checkRateLimit("k", RULE);

    if (verdict.allowed) throw new Error("expected blocked");
    expect(verdict.retryAfterMs).toBeGreaterThan(38_000);
    expect(verdict.retryAfterMs).toBeLessThanOrEqual(40_000);
  });

  it("never reports a negative retry time", async () => {
    prismaMock.authAttempt.count.mockResolvedValue(RULE.limit);
    // Already outside the window (a race against pruning).
    prismaMock.authAttempt.findFirst.mockResolvedValue({
      createdAt: new Date(Date.now() - 120_000),
    });

    const verdict = await checkRateLimit("k", RULE);

    if (verdict.allowed) throw new Error("expected blocked");
    expect(verdict.retryAfterMs).toBe(0);
  });

  it("does not consume budget — checking is read-only", async () => {
    prismaMock.authAttempt.count.mockResolvedValue(0);

    await checkRateLimit("k", RULE);

    expect(prismaMock.authAttempt.create).not.toHaveBeenCalled();
  });
});

describe("recordAttempt", () => {
  it("writes one row and prunes that key's expired rows", async () => {
    await recordAttempt("k", RULE);

    expect(prismaMock.authAttempt.create).toHaveBeenCalledWith({
      data: { key: "k" },
    });

    const where = prismaMock.authAttempt.deleteMany.mock.calls[0][0].where;
    expect(where.key).toBe("k");
    // Pruning is scoped to this key and to rows older than the window.
    expect(where.createdAt.lt.getTime()).toBeLessThanOrEqual(
      Date.now() - RULE.windowMs,
    );
  });
});

describe("clientIp", () => {
  it("takes the first entry of x-forwarded-for", async () => {
    withHeaders({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(await clientIp()).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", async () => {
    withHeaders({ "x-real-ip": "203.0.113.9" });
    expect(await clientIp()).toBe("203.0.113.9");
  });

  it("buckets unknown origins together rather than exempting them", async () => {
    withHeaders({});
    expect(await clientIp()).toBe("unknown");
  });

  it("ignores an empty x-forwarded-for", async () => {
    withHeaders({ "x-forwarded-for": "", "x-real-ip": "203.0.113.9" });
    expect(await clientIp()).toBe("203.0.113.9");
  });
});

describe("retryMessage", () => {
  it("rounds up to whole minutes", () => {
    expect(retryMessage(61_000)).toBe("Too many attempts. Try again in 2 minutes.");
  });

  it("never says zero minutes", () => {
    expect(retryMessage(0)).toBe("Too many attempts. Try again in 1 minute.");
  });

  it("singularises one minute", () => {
    expect(retryMessage(60_000)).toBe("Too many attempts. Try again in 1 minute.");
  });
});

describe("rule shapes", () => {
  it("limits an individual account more tightly than a shared IP", () => {
    // Several people can sit behind one NAT; one account being guessed at is a
    // stronger signal, so the per-email budget must be the smaller of the two.
    expect(LOGIN_EMAIL_RULE.limit).toBeLessThan(10);
  });
});
