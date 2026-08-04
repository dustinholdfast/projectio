import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createResendMailer, getMailer } from "@/lib/mailer";

// Tests for transport selection and the Resend call. The point of the selection
// tests is that a misconfiguration falls back to the log transport rather than
// throwing at request time — a half-configured provider must not take the app
// down, it must degrade and say so.

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.MAIL_OUTBOX_PATH;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("createResendMailer", () => {
  function mockFetch(response: Partial<Response> & { ok: boolean }) {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => "",
      ...response,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts the message to Resend with the configured sender", async () => {
    const fetchMock = mockFetch({ ok: true });

    await createResendMailer("key_123", "Project/IO <no-reply@example.com>").send({
      to: "someone@example.com",
      subject: "Reset your password",
      text: "link",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer key_123");

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      from: "Project/IO <no-reply@example.com>",
      to: ["someone@example.com"],
      subject: "Reset your password",
      text: "link",
    });
  });

  it("sends a timeout signal, so a stalled provider cannot hold the request open", async () => {
    const fetchMock = mockFetch({ ok: true });

    await createResendMailer("k", "f@example.com").send({
      to: "a@example.com",
      subject: "s",
      text: "t",
    });

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on a rejection, keeping the provider's own explanation", async () => {
    mockFetch({
      ok: false,
      status: 403,
      text: async () => '{"message":"The example.com domain is not verified"}',
    });

    const send = createResendMailer("k", "f@example.com").send({
      to: "a@example.com",
      subject: "s",
      text: "t",
    });

    // Resend's failures are specific and actionable; losing that detail would
    // make this near-impossible to diagnose from logs alone.
    await expect(send).rejects.toThrow(/403/);
    await expect(send).rejects.toThrow(/not verified/);
  });

  it("still throws when the error body cannot be read", async () => {
    mockFetch({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("stream closed");
      },
    });

    await expect(
      createResendMailer("k", "f@example.com").send({
        to: "a@example.com",
        subject: "s",
        text: "t",
      }),
    ).rejects.toThrow(/500/);
  });
});

describe("getMailer", () => {
  it("uses Resend when both the key and sender are set", async () => {
    process.env.RESEND_API_KEY = "key_123";
    process.env.EMAIL_FROM = "no-reply@example.com";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await getMailer().send({ to: "a@example.com", subject: "s", text: "t" });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to the log transport when nothing is configured", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await getMailer().send({ to: "a@example.com", subject: "s", text: "t" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });

  it("falls back when the key is set but the sender is missing", async () => {
    // Half-configured is the dangerous case: it must degrade to the log
    // transport rather than call Resend with an undefined `from` and fail every
    // send at request time.
    process.env.RESEND_API_KEY = "key_123";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await getMailer().send({ to: "a@example.com", subject: "s", text: "t" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });
});
