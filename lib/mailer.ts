import { appendFile } from "node:fs/promises";

// Outbound email, behind a one-method interface.
//
// No provider is wired up: sending real mail needs an account, a verified
// sending domain, and credentials, none of which belong in the codebase. The
// flow that depends on this (password reset) is therefore complete and testable
// today, and gains real delivery the moment a provider is added below.
//
// To add one, implement `Mailer` and return it from `getMailer()`:
//
//   const resendMailer: Mailer = {
//     async send(message) {
//       await fetch("https://api.resend.com/emails", {
//         method: "POST",
//         headers: {
//           Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({ from: process.env.EMAIL_FROM, ...message }),
//       });
//     },
//   };

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development transport: writes the message to the server log so the reset link
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
 * The transport for this environment.
 *
 * In production without a real provider this still resolves to `consoleMailer`,
 * which means reset links land in the server log rather than a user's inbox —
 * functional, but not something to leave in place. It warns once so that state
 * is visible rather than silent. See DEPLOYMENT.md §10.3.
 */
let warned = false;

export function getMailer(): Mailer {
  if (process.env.NODE_ENV === "production" && !warned) {
    warned = true;
    console.warn(
      "[mailer] No email provider configured — password reset links are being written to the server log instead of being delivered. See lib/mailer.ts.",
    );
  }
  return consoleMailer;
}
