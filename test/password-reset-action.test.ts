import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression test for an account-enumeration leak.
//
// Only a *real* account reaches the send call, so an unhandled transport failure
// would answer the exact question this flow refuses to answer: an unknown address
// returns the confirmation, while a registered one returns an error. With the
// console transport that never happened — it cannot fail. Adding a network call
// to Resend made it reachable.
const { prismaMock, mailerMock, headersMock, rateLimitMocks } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    authAttempt: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    passwordResetToken: { updateMany: vi.fn(), create: vi.fn() },
  },
  mailerMock: { send: vi.fn() },
  headersMock: vi.fn(),
  rateLimitMocks: { checkRateLimit: vi.fn(), recordAttempt: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/mailer", () => ({ getMailer: () => mailerMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: rateLimitMocks.checkRateLimit,
  recordAttempt: rateLimitMocks.recordAttempt,
}));

import { requestPasswordReset } from "@/lib/actions/password-reset";

function form(email: string): FormData {
  const data = new FormData();
  data.append("email", email);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  headersMock.mockResolvedValue({ get: () => null });
  rateLimitMocks.checkRateLimit.mockResolvedValue({ allowed: true });
  rateLimitMocks.recordAttempt.mockResolvedValue(undefined);
  prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.passwordResetToken.create.mockResolvedValue({});
  mailerMock.send.mockResolvedValue(undefined);
});

describe("requestPasswordReset", () => {
  it("returns the same response for a registered address", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });

    expect(await requestPasswordReset(undefined, form("real@example.com"))).toEqual({
      sent: true,
    });
    expect(mailerMock.send).toHaveBeenCalledOnce();
  });

  it("returns the same response for an unknown address, and sends nothing", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    expect(await requestPasswordReset(undefined, form("nobody@example.com"))).toEqual({
      sent: true,
    });
    expect(mailerMock.send).not.toHaveBeenCalled();
  });

  it("returns that same response when the provider fails, rather than throwing", async () => {
    // The leak: an unhandled throw here would mark this address as registered.
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    mailerMock.send.mockRejectedValue(new Error("Resend rejected the message (403)"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await requestPasswordReset(undefined, form("real@example.com"));

    expect(result).toEqual({ sent: true });
    // Silent to the user, loud in the logs — the only signal a real outage gives.
    expect(consoleError).toHaveBeenCalled();
  });

  it("is indistinguishable across all three cases", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    const ok = await requestPasswordReset(undefined, form("a@example.com"));

    prismaMock.user.findUnique.mockResolvedValue(null);
    const unknown = await requestPasswordReset(undefined, form("b@example.com"));

    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    mailerMock.send.mockRejectedValue(new Error("down"));
    const failed = await requestPasswordReset(undefined, form("c@example.com"));

    expect(ok).toEqual(unknown);
    expect(unknown).toEqual(failed);
  });

  it("still rejects a malformed address before any lookup", async () => {
    expect(await requestPasswordReset(undefined, form("not-an-email"))).toEqual({
      error: "Enter a valid email address.",
    });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});
