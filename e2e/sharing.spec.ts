import { expect, test, type Page } from "@playwright/test";
import { gotoReady, waitForLanding } from "./helpers";

// Sharing, end to end and across two real accounts.
//
// The assertions that matter are the negative ones: a viewer cannot write, and a
// non-member still cannot see anything. Sharing rewrote every authorisation check
// in the app, so "the boundary still holds" is the thing worth proving, not the
// happy path.

const OWNER_EMAIL = "demo@example.com";
const OWNER_PASSWORD = "password123";
const GUEST_EMAIL = "sharing-guest@example.com";
const GUEST_PASSWORD = "guest-password-1";
const LATE_EMAIL = "sharing-late@example.com";
const LATE_PASSWORD = "guest-password-4";

async function signIn(page: Page, email: string, password: string) {
  await gotoReady(page, "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForLanding(page);
}

async function signUp(page: Page, email: string, password: string) {
  await gotoReady(page, "/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await waitForLanding(page);
}

async function signOut(page: Page) {
  await gotoReady(page, "/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login$/);
  await page.waitForLoadState("networkidle");
}

/**
 * Sign in to a fixture account, creating it only if the seed has not.
 *
 * These accounts are seeded (see prisma/seed.ts) precisely so this takes the
 * sign-in path: signup is rate limited to 5/hour per IP and the whole suite
 * shares one address, so spending that budget on scenery accounts starves the
 * tests that actually exercise signup.
 */
async function ensureAccount(page: Page, email: string, password: string) {
  await gotoReady(page, "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const signedIn = await Promise.race([
    page.waitForURL(/\/$/).then(() => true),
    page
      .locator("form")
      .getByRole("alert")
      .filter({ hasText: "Invalid email or password" })
      .waitFor()
      .then(() => false),
  ]);
  if (signedIn) {
    await page.waitForLoadState("networkidle");
    return;
  }

  await signUp(page, email, password);
}

/** Create a board of our own, so these tests never disturb the seeded ones. */
async function createBoard(page: Page, name: string): Promise<string> {
  await gotoReady(page, "/");
  await page.getByLabel("Board name").fill(name);
  await page.getByRole("button", { name: "Create board" }).click();
  await expect(page).toHaveURL(/\/board\/[^/]+$/);
  return page.url();
}

/** Open the share panel and mint a link at the given role. Returns its URL. */
async function createShareLink(page: Page, role: "Viewer" | "Editor") {
  await page.getByRole("button", { name: /^Share/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New link grants").selectOption({ label: role });
  await dialog.getByRole("button", { name: "Create link" }).click();

  const link = dialog.getByTestId("new-share-link");
  await expect(link).toBeVisible();
  const url = await link.locator("code").innerText();
  await page.keyboard.press("Escape");
  return url.trim();
}

test("a viewer can see the board but cannot change it", async ({ page }) => {
  const stamp = Date.now();
  const boardName = `Shared viewer ${stamp}`;

  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
  const boardUrl = await createBoard(page, boardName);

  // Give the board a card, so the guest has something to try to edit.
  const column = page.getByTestId("board-column").first();
  await page.getByRole("button", { name: "+ Add a column" }).click();
  await page.getByLabel("Column name").fill("To Do");
  await page.getByRole("button", { name: "Add column" }).click();
  await expect(page.getByRole("heading", { name: "To Do" })).toBeVisible();
  await page.getByRole("button", { name: "+ Add a card" }).click();
  await page.getByLabel("Card title").fill("Owner's card");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByText("Owner's card")).toBeVisible();

  const viewerLink = await createShareLink(page, "Viewer");

  // Become someone else entirely.
  await signOut(page);
  await ensureAccount(page, GUEST_EMAIL, GUEST_PASSWORD);

  await gotoReady(page, viewerLink);
  await page.getByRole("button", { name: /^Join/ }).click();
  await expect(page).toHaveURL(/\/board\/[^/]+$/);

  // Can read it...
  await expect(page.getByText("Owner's card")).toBeVisible();
  await expect(page.getByTestId("board-role")).toHaveText("Viewer");

  // ...and none of the write affordances are offered.
  await expect(page.getByRole("button", { name: "+ Add a card" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Add a column" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Share/ })).toHaveCount(0);

  // The card dialog opens read-only: no save, no delete.
  await page.locator('[data-testid="board-card"]').first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("You have view-only access")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Delete card" })).toHaveCount(0);
  expect(await dialog.getByLabel("Owner").isEditable()).toBe(false);
});

test("a signed-out recipient returns to the invitation after signup", async ({ page }) => {
  const stamp = Date.now();
  const boardName = `Invitation callback ${stamp}`;
  const guest = `callback-${stamp}@example.com`;

  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
  await createBoard(page, boardName);
  const viewerLink = await createShareLink(page, "Viewer");

  await signOut(page);
  await gotoReady(page, viewerLink);

  // The public join page preserves the token through both auth screens.
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  await page.getByRole("link", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/signup\?callbackUrl=/);
  await page.getByLabel("Email").fill(guest);
  await page.getByLabel("Password").fill("guest-password-callback");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/join\//);
  await page.getByRole("button", { name: new RegExp(`^Join ${boardName}$`) }).click();
  await expect(page).toHaveURL(/\/board\/[^/]+$/);
  await expect(page.getByTestId("board-role")).toHaveText("Viewer");
});

test("an editor can change the board but not share or delete it", async ({ page }) => {
  const stamp = Date.now();
  const boardName = `Shared editor ${stamp}`;

  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
  await createBoard(page, boardName);
  await page.getByRole("button", { name: "+ Add a column" }).click();
  await page.getByLabel("Column name").fill("To Do");
  await page.getByRole("button", { name: "Add column" }).click();
  await expect(page.getByRole("heading", { name: "To Do" })).toBeVisible();

  const editorLink = await createShareLink(page, "Editor");

  await signOut(page);
  await ensureAccount(page, GUEST_EMAIL, GUEST_PASSWORD);
  await gotoReady(page, editorLink);
  await page.getByRole("button", { name: /^Join/ }).click();
  await expect(page).toHaveURL(/\/board\/[^/]+$/);

  await expect(page.getByTestId("board-role")).toHaveText("Editor");

  // Can write.
  await page.getByRole("button", { name: "+ Add a card" }).click();
  await page.getByLabel("Card title").fill("Editor's card");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByText("Editor's card")).toBeVisible();

  // But sharing and deleting stay with the owner.
  await expect(page.getByRole("button", { name: /^Share/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("a revoked link stops new joins but keeps existing members", async ({ page }) => {
  const stamp = Date.now();
  const boardName = `Revoked ${stamp}`;

  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
  const boardUrl = await createBoard(page, boardName);
  const link = await createShareLink(page, "Editor");

  // One person joins while the link is live.
  await signOut(page);
  await ensureAccount(page, GUEST_EMAIL, GUEST_PASSWORD);
  await gotoReady(page, link);
  await page.getByRole("button", { name: /^Join/ }).click();
  await expect(page).toHaveURL(/\/board\/[^/]+$/);

  // The owner revokes it.
  await signOut(page);
  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
  await gotoReady(page, boardUrl);
  await page.getByRole("button", { name: /^Share/ }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("board-member")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Revoke link" }).click();
  await expect(dialog.getByText("No active links")).toBeVisible();
  // Revoking does not evict anyone who already joined.
  await expect(dialog.getByTestId("board-member")).toHaveCount(2);
  await page.keyboard.press("Escape");

  // A newcomer with the same URL gets nothing.
  await signOut(page);
  await ensureAccount(page, LATE_EMAIL, LATE_PASSWORD);
  await gotoReady(page, link);
  await expect(page.getByText("This link is not valid")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Join/ })).toHaveCount(0);
});

test("a non-member still cannot reach the board at all", async ({ page }) => {
  const stamp = Date.now();

  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
  const boardUrl = await createBoard(page, `Private ${stamp}`);

  await signOut(page);
  await ensureAccount(page, GUEST_EMAIL, GUEST_PASSWORD);
  await gotoReady(page, boardUrl);

  // The boundary that existed before sharing must survive it: no membership
  // means a 404, not a redirect and not a read-only view.
  await expect(
    page.getByText(/This page could not be found|404/i).first(),
  ).toBeVisible();
});
