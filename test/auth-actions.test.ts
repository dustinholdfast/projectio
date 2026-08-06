import { beforeEach, describe, expect, it, vi } from "vitest";

const { signInMock, prismaMock, rateLimitMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn(), create: vi.fn() },
  },
  rateLimitMock: {
    checkRateLimit: vi.fn(),
    clientIp: vi.fn(),
    recordAttempt: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ signIn: signInMock, signOut: vi.fn() }));
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {
    type = "AuthError";
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/rate-limit", () => ({
  LOGIN_EMAIL_RULE: {},
  LOGIN_IP_RULE: {},
  SIGNUP_IP_RULE: {},
  checkRateLimit: rateLimitMock.checkRateLimit,
  clientIp: rateLimitMock.clientIp,
  recordAttempt: rateLimitMock.recordAttempt,
  retryMessage: vi.fn(() => "Try later."),
}));

import { login } from "@/lib/actions/auth";

function loginForm(callbackUrl: string): FormData {
  const data = new FormData();
  data.set("email", "member@example.com");
  data.set("password", "correct horse battery staple");
  data.set("callbackUrl", callbackUrl);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  rateLimitMock.clientIp.mockResolvedValue("127.0.0.1");
  rateLimitMock.checkRateLimit.mockResolvedValue({ allowed: true });
  signInMock.mockRejectedValue(new Error("NEXT_REDIRECT"));
});

describe("login callback", () => {
  it("returns a successful sign-in to the invitation", async () => {
    await expect(login(undefined, loginForm("/join/token-123"))).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "member@example.com",
      password: "correct horse battery staple",
      redirectTo: "/join/token-123",
    });
  });

  it("does not pass a cross-origin callback to Auth.js", async () => {
    await expect(
      login(undefined, loginForm("//attacker.example/steal")),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInMock).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/" }),
    );
  });
});
