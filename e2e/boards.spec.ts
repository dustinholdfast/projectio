import { expect, test, type Page } from "@playwright/test";
import { gotoReady, waitForLanding } from "./helpers";

// Coverage of the multi-board surface: the list, creating a board, renaming it,
// deleting it, and the ownership boundary between accounts.

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "password123";

async function loginAsDemo(page: Page) {
  await gotoReady(page, "/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForLanding(page);
}

test("lists every seeded board and opens one", async ({ page }) => {
  await loginAsDemo(page);

  const tiles = page.getByTestId("board-tile");
  await expect(tiles.filter({ hasText: "Product Roadmap" })).toBeVisible();
  await expect(tiles.filter({ hasText: "Website Refresh" })).toBeVisible();

  // Counts come from the aggregate query, not from loading every card. Asserted
  // against "Website Refresh" because no other spec mutates it — the card count
  // on "Product Roadmap" depends on whether board.spec has run yet.
  await expect(tiles.filter({ hasText: "Website Refresh" })).toContainText(
    "3 columns · 3 cards",
  );

  await tiles.filter({ hasText: "Website Refresh" }).click();
  await expect(page).toHaveURL(/\/board\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
});

test("creates a board, opens it, renames it, and deletes it", async ({ page }) => {
  await loginAsDemo(page);

  const name = `E2E Board ${Date.now()}`;
  await page.getByLabel("Board name").fill(name);
  await page.getByRole("button", { name: "Create board" }).click();

  // Creating opens the new board rather than dropping you back on the list.
  await expect(page).toHaveURL(/\/board\/[^/]+$/);
  const boardUrl = page.url();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // Rename, and confirm it sticks on both the board and the list.
  const renamed = `${name} renamed`;
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Board name").fill(renamed);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible();

  await gotoReady(page, "/");
  await expect(
    page.getByTestId("board-tile").filter({ hasText: renamed }),
  ).toBeVisible();

  // Delete, which requires confirming first.
  await page.goto(boardUrl);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/Delete .* and everything on it\?/)).toBeVisible();
  await page.getByRole("button", { name: "Delete board" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByTestId("board-tile").filter({ hasText: renamed }),
  ).toHaveCount(0);
});

test("a board belonging to another account is not reachable", async ({ page }) => {
  // Note the id of a board the demo user owns...
  await loginAsDemo(page);
  await page.getByTestId("board-tile").filter({ hasText: "Product Roadmap" }).click();
  await expect(page).toHaveURL(/\/board\/[^/]+$/);
  const victimUrl = page.url();

  // ...then become a different user and try to open it directly.
  await page.context().clearCookies();
  await gotoReady(page, "/signup");
  await page.getByLabel("Email").fill(`intruder-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("intruder-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(victimUrl);

  // A 404, not a redirect and not the board — the page must not even confirm
  // that someone else's board exists. (Next's 404 renders the text in more than
  // one node, hence .first().)
  await expect(
    page.getByText(/This page could not be found|404/i).first(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "To Do" })).toHaveCount(0);
});
