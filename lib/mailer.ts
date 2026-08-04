import { appendFile } from "node:fs/promises";

// Outbound email.
//
// One interface, two transports, chosen by configuration:
//   • Resend, when RESEND_API_KEY is set — the real one.
//   • Console, otherwise — writes the message to the server log so password
//     reset stays usable in development without any provider account.
//
// Callers must treat a failed send as *possible*: see the note on `send` below.

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface Mailer {
  /**
   * Deliver a message, or throw.
   *
   * Throwing is deliberate — a transport that swallowed failures would leave
   * "we sent it" indistinguishable from "it vanished". Callers decide what a
   * failure means for the user; `requestPasswordReset` logs it and still returns
   * its generic response, because varying the response by outcome would leak
   * which addresses have accounts.
   */
  send(message: EmailMessage): Promise<void>;
}

/** How long to wait on the provider before giving up. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Development transport: writes the message to the server log, so the reset link
 * is usable without any provider.
 *
 * Also appends to `MAIL_OUTBOX_PATH` when set, as JSON lines. That exists so the
 * end-to-end test can read the link it was "sent" — the only way to exercise the
 * real flow without a mail provider. It is inert unless the variable is set, and
 * nothing sets it outside the test config.
 */
export const consoleMailer: Mailer = {
  async send(message) {
    console.info(
      `\n── email ─────────────────────────────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n──────────────────────────────────────\n`,
    );

    const outbox = process.env.MAIL_OUTBOX_PATH;
    if (outbox) {
      await appendFile(outbox, `${JSON.stringify(message)}\n`, "utf8");
    }
  },
};

/**
 * Resend transport.
 *
 * Plain `fetch` rather than the `resend` SDK: this is one POST to one endpoint,
 * and a dependency that ships its own HTTP client and types earns nothing here.
 *
 * The timeout matters more than it looks. Without it a stalled provider would
 * hold the server action open until the platform's own limit, turning a slow
 * mail API into slow page loads for everyone.
 */
export function createResendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      if (!response.ok) {
        // Include the provider's own message: Resend's failures are specific and
        // actionable ("domain is not verified", "invalid from address"), and
        // losing that detail would make this very hard to diagnose from logs.
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Resend rejected the message (${response.status}): ${detail.slice(0, 500)}`,
        );
      }
    },
  };
}

let warnedNoProvider = false;

/**
 * The transport for this environment.
 *
 * Falling back to the console transport in production is a real state, not a
 * theoretical one — it means reset links are landing in the server log instead of
 * inboxes. It warns once so that is visible rather than silent.
 */
export function getMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (apiKey && from) return createResendMailer(apiKey, from);

  if (process.env.NODE_ENV === "production" && !warnedNoProvider) {
    warnedNoProvider = true;
    console.warn(
      apiKey && !from
        ? "[mailer] RESEND_API_KEY is set but EMAIL_FROM is not — falling back to the log transport. Set EMAIL_FROM to a verified sender."
        : "[mailer] No email provider configured — password reset links are being written to the server log instead of being delivered. Set RESEND_API_KEY and EMAIL_FROM.",
    );
  }

  return consoleMailer;
}
