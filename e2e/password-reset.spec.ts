import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { MAIL_OUTBOX_PATH } from "../playwright.config";
import { gotoReady } from "./helpers";

// End-to-end coverage of account recovery: request a link, redeem it, and sign
// in with the new password. The link is read from the mail outbox the console
// mailer mirrors to (see lib/mailer.ts) — the only way to exercise the real flow
// without a mail provider.
//
// Uses its own account so it cannot disturb the seeded demo user.
const EMAIL = "reset-target@example.com";
const OLD_PASSWORD = "original-password";
const NEW_PASSWORD = "a-brand-new-password";

/** Most recent message sent to `to`, or undefined if none. */
function lastMailTo(to: string): { subject: string; text: string } | undefined {
  let contents: string;
  try {
    contents = readFileSync(MAIL_OUTBOX_PATH, "utf8");
  } catch {
    return undefined;
  }
  const messages = contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; subject: string; text: string });
  return messages.reverse().find((m) => m.to === to);
}

function resetLinkFrom(text: string): string {
  const match = text.match(/https?:\/\/\S+\/reset-password\?token=\S+/);
  if (!match) throw new Error(`No reset link in email:\n${text}`);
  return match[0];
}

test("resets a forgotten password and signs in with the new one", async ({
  page,
}) => {
  // Create the account to recover, then drop its session.
  await gotoReady(page, "/signup");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(OLD_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.context().clearCookies();

  // Request a link from the login page's entry point.
  await gotoReady(page, "/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(/reset link is on its way/i);

  // Read the link out of the outbox.
  await expect
    .poll(() => lastMailTo(EMAIL)?.subject, { timeout: 10_000 })
    .toBe("Reset your password");
  const link = resetLinkFrom(lastMailTo(EMAIL)!.text);

  // Redeem it.
  await gotoReady(page, link);
  await expect(page.getByText("Choose a new password")).toBeVisible();
  // Exact, or "New password" also matches "Confirm new password".
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set new password" }).click();

  // Redirected to sign in, with confirmation that the change landed.
  await expect(page).toHaveURL(/\/login\?reset=1$/);
  await expect(page.getByRole("status")).toContainText(/password has been changed/i);

  // The link is single-use: going back to it must now be refused.
  await gotoReady(page, link);
  await expect(page.getByRole("alert").first()).toContainText(
    /invalid or has expired/i,
  );

  // The old password no longer works. Scoped to the form: Next's dev overlay
  // also exposes a role="alert" node.
  await gotoReady(page, "/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(OLD_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    /Invalid email or password/,
  );

  // ...and the new one does.
  await gotoReady(page, "/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("does not reveal whether an address has an account", async ({ page }) => {
  await gotoReady(page, "/forgot-password");
  await page.getByLabel("Email").fill("definitely-not-registered@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();

  // Same confirmation a real account gets...
  await expect(page.getByRole("status")).toContainText(/reset link is on its way/i);
  // ...and no mail actually sent.
  expect(lastMailTo("definitely-not-registered@example.com")).toBeUndefined();
});
