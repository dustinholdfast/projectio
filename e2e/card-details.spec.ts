import { expect, test, type Page } from "@playwright/test";
import { gotoReady, gotoBoards, waitForLanding } from "./helpers";

// Coverage of the card detail dialog: opening it by clicking a card, saving the
// detail fields, the checklist, and the blocked-by graph including its refusals.

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "password123";

async function openBoard(page: Page) {
  await gotoReady(page, "/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForLanding(page);
  await gotoBoards(page);

  await page.getByTestId("board-tile").filter({ hasText: "Product Roadmap" }).click();
  await expect(page).toHaveURL(/\/board\/[^/]+$/);
}

async function openCard(page: Page, title: string) {
  await page.locator(`[data-testid="board-card"][data-card-title="${title}"]`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("opens a card and saves the detail fields", async ({ page }) => {
  await openBoard(page);
  await openCard(page, "Build board view");

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Owner").fill("Alex Rivera");
  await dialog.getByLabel("Category").fill("Frontend");
  await dialog.getByLabel("Priority").selectOption("HIGH");
  await dialog.getByLabel("Date started").fill("2026-07-20");
  await dialog.getByLabel("Notes").fill("Needs a design review before merging.");
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(dialog).toBeHidden();

  // The card face shows what was set.
  const card = page.locator('[data-card-title="Build board view"]');
  await expect(card.getByTestId("card-owner")).toHaveText("Alex Rivera");
  await expect(card.getByTestId("card-priority")).toHaveText("High");
  await expect(card.getByTestId("card-category")).toHaveText("Frontend");

  // And it survives a reload, so it was persisted rather than held in state.
  await page.reload();
  await openCard(page, "Build board view");
  await expect(page.getByRole("dialog").getByLabel("Owner")).toHaveValue("Alex Rivera");
  await expect(page.getByRole("dialog").getByLabel("Notes")).toHaveValue(
    "Needs a design review before merging.",
  );
});

test("refuses a completion date that precedes the start date", async ({ page }) => {
  await openBoard(page);
  await openCard(page, "Draft product requirements");

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Date started").fill("2026-07-10");
  await dialog.getByLabel("Date completed").fill("2026-07-01");
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(dialog.getByRole("alert")).toContainText(
    /cannot be before date started/i,
  );
  // Still open, so the typo can be corrected rather than silently discarded.
  await expect(dialog).toBeVisible();
});

test("completing a card moves it to the Completed lane", async ({ page }) => {
  await openBoard(page);

  // Creates its own card rather than completing a seeded one. The database is
  // shared across the whole run, and due-status.spec asserts which lane every
  // seeded card sits in — completing one here would move it out from under those
  // assertions and fail a spec that has nothing wrong with it.
  const title = `Completion target ${Date.now()}`;
  const todo = page
    .getByTestId("board-column")
    .filter({ has: page.getByRole("heading", { name: "To Do", exact: true }) });
  await todo.getByRole("button", { name: "+ Add a card" }).click();
  await todo.getByLabel("Card title").fill(title);
  await todo.getByRole("button", { name: "Add card" }).click();
  await expect(todo.getByText(title)).toBeVisible();

  await openCard(page, title);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Date completed").fill("2026-08-01");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  await page.getByTestId("group-due").click();
  await expect(
    page.locator('[data-testid="due-lane"][data-due-status="completed"]'),
  ).toContainText(title);
});

test("adds and ticks checklist items", async ({ page }) => {
  await openBoard(page);
  await openCard(page, "Wire up credential auth");

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New checklist item").fill("Write the login form");
  await dialog.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(dialog.getByText("Write the login form")).toBeVisible();

  // By role: the "Remove …" button's label also contains the item text, so a
  // plain getByLabel matches two elements.
  await dialog.getByRole("checkbox", { name: "Write the login form" }).check();
  await expect(dialog.getByText("1/1")).toBeVisible();

  await page.keyboard.press("Escape");
  const card = page.locator('[data-card-title="Wire up credential auth"]');
  await expect(card.getByTestId("card-checklist")).toContainText("1/1");
});

test("blocks a card, and refuses the loop that would close", async ({ page }) => {
  await openBoard(page);

  // Both cards are ones no other test in this file completes. That matters: the
  // card face counts only *unfinished* blockers, so a completed blocker would
  // correctly show nothing and make this look like a failure.
  const blockedTitle = "Draft product requirements";
  const blockerTitle = "Set up project repository";

  await openCard(page, blockedTitle);
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Card that blocks this one")
    .selectOption({ label: blockerTitle });
  await dialog.getByRole("button", { name: "Add", exact: true }).last().click();
  await expect(dialog.getByText(blockerTitle)).toBeVisible();
  await page.keyboard.press("Escape");

  const blocked = page.locator(`[data-card-title="${blockedTitle}"]`);
  await expect(blocked.getByTestId("card-blocked")).toContainText("Blocked by 1");

  // The reverse link would close a loop, and must be refused.
  await openCard(page, blockerTitle);
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Card that blocks this one")
    .selectOption({ label: blockedTitle });
  await dialog.getByRole("button", { name: "Add", exact: true }).last().click();

  await expect(dialog.getByRole("alert")).toContainText(/loop/i);
});

test("deletes a card, and says what the delete takes with it", async ({ page }) => {
  await openBoard(page);

  // Its own cards: deleting a seeded one would move it out from under the
  // assertions in due-status.spec, which reads the same shared database.
  const stamp = Date.now();
  const doomed = `Doomed card ${stamp}`;
  const waiter = `Waiting card ${stamp}`;

  const todo = page
    .getByTestId("board-column")
    .filter({ has: page.getByRole("heading", { name: "To Do", exact: true }) });

  // Open the form once: it stays open and clears after each add, so you can
  // enter several cards in a row. Clicking "+ Add a card" again would find no
  // button, because the form has replaced it.
  await todo.getByRole("button", { name: "+ Add a card" }).click();
  for (const title of [doomed, waiter]) {
    await todo.getByLabel("Card title").fill(title);
    await todo.getByRole("button", { name: "Add card" }).click();
    await expect(todo.getByText(title)).toBeVisible();
  }

  // Make one wait on the other, plus give the doomed card a checklist item, so
  // the confirm has both consequences to report.
  await openCard(page, waiter);
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Card that blocks this one").selectOption({ label: doomed });
  await dialog.getByRole("button", { name: "Add", exact: true }).last().click();
  await expect(dialog.getByText(doomed)).toBeVisible();
  await page.keyboard.press("Escape");

  await openCard(page, doomed);
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("New checklist item").fill("Something to lose");
  await dialog.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(dialog.getByText("Something to lose")).toBeVisible();

  // The confirm names both consequences before anything is destroyed.
  await dialog.getByRole("button", { name: "Delete card" }).click();
  await expect(dialog.getByText(`Delete “${doomed}”?`)).toBeVisible();
  await expect(dialog.getByText(/1 checklist item/)).toBeVisible();
  await expect(dialog.getByText(/1 card waiting on it will be unblocked/)).toBeVisible();

  await dialog.getByRole("button", { name: "Delete card" }).click();
  await expect(dialog).toBeHidden();

  // Gone, and gone after a reload rather than only from local state.
  await expect(page.locator(`[data-card-title="${doomed}"]`)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(`[data-card-title="${doomed}"]`)).toHaveCount(0);

  // The waiting card survives and is no longer blocked.
  const survivor = page.locator(`[data-card-title="${waiter}"]`);
  await expect(survivor).toHaveCount(1);
  await expect(survivor.getByTestId("card-blocked")).toHaveCount(0);
});

test("cancelling the delete confirm leaves the card alone", async ({ page }) => {
  await openBoard(page);

  const title = "Set up project repository";
  await openCard(page, title);
  const dialog = page.getByRole("dialog");

  await dialog.getByRole("button", { name: "Delete card" }).click();
  await expect(dialog.getByText(`Delete “${title}”?`)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).last().click();

  await page.keyboard.press("Escape");
  await expect(page.locator(`[data-card-title="${title}"]`)).toHaveCount(1);
});
