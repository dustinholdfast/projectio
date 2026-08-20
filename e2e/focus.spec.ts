import { expect, test, type Page } from "@playwright/test";
import { gotoReady, waitForLanding } from "./helpers";

// Coverage of the Focus pane: login lands on the ranked queue, the seeded
// overdue/urgent card sits at the top, a card created from the pane can be
// completed, and the board list still lives at /boards.
//
// Specs that mutate create their own card. Completing a seeded card would
// move it out of the lane due-status.spec and board.spec assert on.

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "password123";

async function loginAsDemo(page: Page) {
  await gotoReady(page, "/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForLanding(page);
}

test("login lands on Focus with the most urgent card first", async ({ page }) => {
  await loginAsDemo(page);

  await expect(page.getByRole("heading", { name: "Focus", exact: true })).toBeVisible();
  const now = page.getByTestId("focus-now");
  await expect(now).toBeVisible();
  // Seeded: overdue 3 days + URGENT outranks everything else on the demo boards.
  await expect(now).toContainText("Set up project repository");
  await expect(now).toContainText("Product Roadmap");
});

test("a card created from Focus can be completed and lands in Done", async ({
  page,
}) => {
  await loginAsDemo(page);

  const title = `E2E Focus ${Date.now()}`;
  await page.getByRole("button", { name: "New card" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Board").selectOption({ label: "Product Roadmap" });
  await page.getByLabel("Due").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Priority").selectOption("HIGH");
  await page.getByRole("button", { name: "Add card" }).click();

  const row = page.locator(`[data-testid="focus-row"][data-card-title="${title}"]`);
  const now = page.getByTestId("focus-now");
  // It may be the new top card (due today + HIGH) or sit in the list.
  const created = now.filter({ hasText: title }).or(row);
  await expect(created.first()).toBeVisible();

  if (await now.filter({ hasText: title }).isVisible()) {
    await now.getByRole("button", { name: "Mark done" }).click();
  } else {
    await row.getByRole("button", { name: "Complete card" }).click();
  }

  await page.getByTestId("focus-lane").filter({ hasText: "Done" }).click();
  await expect(
    page.locator(`[data-testid="focus-row"][data-card-title="${title}"]`),
  ).toBeVisible();
});

test("boards are still listed at /boards", async ({ page }) => {
  await loginAsDemo(page);
  await gotoReady(page, "/boards");

  await expect(
    page.getByTestId("board-tile").filter({ hasText: "Product Roadmap" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("board-tile").filter({ hasText: "Website Refresh" }),
  ).toBeVisible();
});
