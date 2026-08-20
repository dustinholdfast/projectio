import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoReady, gotoBoards, waitForLanding } from "./helpers";

// End-to-end coverage of the board's core flows against a real dev server and a
// freshly-seeded database (see playwright.config.ts / global-setup.ts):
//   • credential login lands on the seeded board;
//   • creating a card persists across a reload;
//   • reordering a card (keyboard drag — the same downward gesture that was
//     off-by-one) persists across a reload.

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "password123";

// Seeded "To Do" column, top-to-bottom (see prisma/seed.ts).
const TODO_CARDS = [
  "Set up project repository",
  "Draft product requirements",
  "Design database schema",
];

/**
 * Sign in and open the seeded "Product Roadmap" board.
 *
 * Login lands on Focus, so these specs go through `/boards` afterwards. The
 * page then sits on /board/[id], which is what makes the plain `page.reload()`
 * calls below still land on the board.
 */
async function login(page: Page): Promise<void> {
  await gotoReady(page, "/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForLanding(page);
  await gotoBoards(page);

  await page
    .getByTestId("board-tile")
    .filter({ hasText: "Product Roadmap" })
    .click();

  await expect(page).toHaveURL(/\/board\/[^/]+$/);
  await expect(
    page.getByRole("heading", { name: "To Do", exact: true }),
  ).toBeVisible();
}

function column(page: Page, name: string): Locator {
  return page
    .getByTestId("board-column")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

function cardTitles(columnLoc: Locator): Promise<(string | null)[]> {
  return columnLoc
    .getByTestId("board-card")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-card-title")));
}

test("logs in and renders the seeded board", async ({ page }) => {
  await login(page);

  await expect(page.getByRole("heading", { name: "In Progress" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
  await expect(cardTitles(column(page, "To Do"))).resolves.toEqual(TODO_CARDS);
});

test("creates a card that persists across a reload", async ({ page }) => {
  await login(page);

  const title = `E2E card ${Date.now()}`;
  const todo = column(page, "To Do");
  await todo.getByRole("button", { name: "+ Add a card" }).click();
  await todo.getByLabel("Card title").fill(title);
  await todo.getByRole("button", { name: "Add card" }).click();

  await expect(todo.getByText(title)).toBeVisible();

  await page.reload();
  await expect(column(page, "To Do").getByText(title)).toBeVisible();
});

test("reorders a card down within a column and persists across a reload", async ({
  page,
}) => {
  await login(page);

  // Compare only the three seeded cards; other tests may have appended cards to
  // this shared, seed-once database, and an appended card always sorts after them.
  const seededOrder = (columnLoc: Locator) =>
    cardTitles(columnLoc).then((titles) => titles.slice(0, 3));

  const todo = column(page, "To Do");
  await expect(seededOrder(todo)).resolves.toEqual(TODO_CARDS);

  // Keyboard drag: focus the first card, pick it up (Space), move it down one
  // slot (ArrowDown), and drop it (Space). This is the same downward same-column
  // move that the reorder off-by-one bug broke.
  // The three presses cannot be fired back-to-back. dnd-kit commits each step to
  // React state before it will accept the next one, so an ArrowDown sent in the
  // same tick as the lift is dropped and the card never moves. Gate each step on
  // dnd-kit's own screen-reader announcements, which change only once a step has
  // actually been applied.
  const announcement = () =>
    page
      .locator('[role="status"]')
      .last()
      .textContent()
      .then((t) => t?.trim() ?? "");

  const firstCard = todo.getByTestId("board-card").first();
  await firstCard.focus();

  await page.keyboard.press("Space");
  await expect(firstCard).toHaveAttribute("aria-pressed", "true");
  const afterLift = await announcement();

  await page.keyboard.press("ArrowDown");
  await expect.poll(announcement).not.toEqual(afterLift);

  // The drop reorders optimistically and fires the reorder server action. Hold
  // the action's response so the reload below cannot outrun the write — the UI
  // updates before persistence completes, and against a networked database that
  // gap is wide enough to lose the race.
  const persisted = page.waitForResponse((r) => r.request().method() === "POST");
  await page.keyboard.press("Space");
  await expect(firstCard).not.toHaveAttribute("aria-pressed", "true");

  const reordered = [TODO_CARDS[1], TODO_CARDS[0], TODO_CARDS[2]];
  await expect.poll(() => seededOrder(column(page, "To Do"))).toEqual(reordered);

  await persisted;
  await page.reload();
  await expect.poll(() => seededOrder(column(page, "To Do"))).toEqual(reordered);
});
