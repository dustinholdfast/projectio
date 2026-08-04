"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { getMailer } from "@/lib/mailer";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import {
  consumeResetToken,
  issueResetToken,
  verifyResetToken,
} from "@/lib/password-reset";
import {
  RESET_REQUEST_EMAIL_RULE,
  RESET_REQUEST_IP_RULE,
  checkRateLimit,
  clientIp,
  recordAttempt,
  retryMessage,
} from "@/lib/rate-limit";

// Server actions for the "forgot password" flow.
//
// The governing rule throughout is that neither action may reveal whether an
// account exists. A request for an unknown address and a request for a real one
// produce the same message, and every way a token can fail — unknown, expired,
// already spent — produces one message too.

export type ResetRequestState = { error?: string; sent?: boolean } | undefined;
export type ResetPasswordState = { error: string } | undefined;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Absolute base URL for links in outbound mail.
 *
 * Derived from the request headers so it works across every host in
 * DEPLOYMENT.md without extra configuration, with `APP_URL` as an override for
 * cases where the public URL differs from what the proxy forwards.
 */
async function appBaseUrl(): Promise<string> {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

/** Step 1: request a reset link. */
export async function requestPasswordReset(
  _prevState: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!isValidEmail(email)) {
    return { error: "Enter a valid email address." };
  }

  const ipKey = `reset:ip:${await clientIp()}`;
  const emailKey = `reset:email:${email}`;

  const ipVerdict = await checkRateLimit(ipKey, RESET_REQUEST_IP_RULE);
  if (!ipVerdict.allowed) return { error: retryMessage(ipVerdict.retryAfterMs) };

  const emailVerdict = await checkRateLimit(emailKey, RESET_REQUEST_EMAIL_RULE);
  if (!emailVerdict.allowed) {
    return { error: retryMessage(emailVerdict.retryAfterMs) };
  }

  // Every accepted request is recorded, including those for addresses with no
  // account: counting only real ones would make the rate limiter itself an
  // account-existence oracle.
  await recordAttempt(ipKey, RESET_REQUEST_IP_RULE);
  await recordAttempt(emailKey, RESET_REQUEST_EMAIL_RULE);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (user) {
    const rawToken = await issueResetToken(user.id);
    const link = `${await appBaseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;

    try {
      await getMailer().send({
        to: email,
        subject: "Reset your password",
        text: [
          "Someone asked to reset the password for this account.",
          "",
          `Open this link to choose a new password: ${link}`,
          "",
          "The link is valid for one hour and can be used once.",
          "If this wasn't you, no action is needed — the password is unchanged.",
        ].join("\n"),
      });
    } catch (error) {
      // A send failure must not change what the caller sees. Only a *real*
      // account reaches this line, so letting the error propagate would make
      // "provider is down" answer the question this whole flow refuses to
      // answer: an unknown address would return the confirmation while a
      // registered one returned an error page.
      //
      // The cost is that a genuine outage looks like success to the user. That
      // is the right trade — but it means the log line below is the only signal,
      // so it is worth alerting on.
      console.error("[password-reset] Failed to send reset email:", error);
    }
  }

  // Identical response either way.
  return { sent: true };
}

/** Step 2: redeem the link and set a new password. */
export async function resetPassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password !== confirm) {
    return { error: "The two passwords do not match." };
  }

  const check = await verifyResetToken(token);
  if (!check.valid) {
    return {
      error: "This reset link is invalid or has expired. Request a new one.",
    };
  }

  // Spend the token before writing the password. If two submissions race, only
  // the one that claims it proceeds.
  const claimed = await consumeResetToken(check.tokenId);
  if (!claimed) {
    return {
      error: "This reset link is invalid or has expired. Request a new one.",
    };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: check.userId },
    data: { passwordHash },
  });

  // The user is not signed in automatically: whoever holds the link is not
  // necessarily the account owner until they can also use the new password.
  redirect("/login?reset=1");
}
