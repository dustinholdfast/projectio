import { expect, test } from "@playwright/test";
import { gotoReady } from "./helpers";

// Verifies the credential rate limiter end to end against a real server and
// database: repeated bad passwords for one account must stop being answered with
// "invalid credentials" and start being refused outright.
//
// LOGIN_EMAIL_RULE allows 5 failures per 15 minutes, so the 6th attempt is the
// first that must be blocked.
//
// This test creates and throttles its OWN account rather than the seeded demo
// user. Throttling `demo@example.com` would lock out every other spec that logs
// in as it, making the suite order-dependent.
const EMAIL = "throttle-target@example.com";
const PASSWORD = "correct-horse-battery";

test("throttles repeated failed logins for one account", async ({ page }) => {
  // Create the target account, then drop the session it hands back so the
  // sign-in form is reachable again.
  await gotoReady(page, "/signup");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /Create account|Sign up/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.context().clearCookies();

  // Assert on the alert's text rather than reading it back: the element becomes
  // visible a beat before React fills it, so a plain textContent() read races
  // and returns "".
  const attempt = async (password: string, expected: RegExp) => {
    await gotoReady(page, "/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").first()).toHaveText(expected);
  };

  // The first five failures are answered generically — no hint that a limit
  // exists, and no clue whether the account does.
  for (let i = 1; i <= 5; i++) {
    await test.step(`failure ${i}`, () =>
      attempt("wrong-password", /Invalid email or password/));
  }

  // The sixth is refused before any password check.
  await attempt("wrong-password", /Too many attempts/);

  // And the block does not depend on the password being wrong: the correct one
  // is refused too, which is the point — an attacker who guesses right while
  // throttled still gets nothing.
  await attempt(PASSWORD, /Too many attempts/);
});
