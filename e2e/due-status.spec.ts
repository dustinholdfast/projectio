import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoReady, waitForLanding } from "./helpers";

// Coverage of the schedule view: the grouping toggle, that seeded cards land in
// the lane their due date implies, and that pausing/scheduling moves them between
// lanes and survives a reload. Five lanes since completion was added — Overdue,
// Due Now, Later, Paused, Completed.
//
// Seeded due dates are relative to the seed run (see prisma/seed.ts), so these
// assertions hold whenever the suite runs.

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "password123";

async function openScheduleView(page: Page) {
  await gotoReady(page, "/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForLanding(page);

  await page.getByTestId("board-tile").filter({ hasText: "Product Roadmap" }).click();
  await expect(page).toHaveURL(/\/board\/[^/]+$/);

  await page.getByTestId("group-due").click();
  await expect(page).toHaveURL(/\?group=due$/);
  await expect(page.getByTestId("due-lane")).toHaveCount(5);
}

function lane(page: Page, status: string): Locator {
  return page.locator(`[data-testid="due-lane"][data-due-status="${status}"]`);
}

function cardByTitle(page: Page, title: string): Locator {
  return page.locator(`[data-testid="board-card"][data-card-title="${title}"]`);
}

function cardTitles(laneLoc: Locator): Promise<(string | null)[]> {
  return laneLoc
    .getByTestId("board-card")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-card-title")));
}

test("groups seeded cards into the lane their due date implies", async ({ page }) => {
  await openScheduleView(page);

  // Seeded -3 and -1 days.
  await expect(cardTitles(lane(page, "overdue"))).resolves.toEqual(
    expect.arrayContaining(["Set up project repository", "Build board view"]),
  );
  // Seeded due today.
  await expect(cardTitles(lane(page, "dueNow"))).resolves.toContain(
    "Draft product requirements",
  );
  // Seeded +14 days but paused — paused wins over the date.
  await expect(cardTitles(lane(page, "paused"))).resolves.toContain(
    "Wire up credential auth",
  );
  // Seeded +7 days.
  const later = await cardTitles(lane(page, "later"));
  expect(later).toContain("Design database schema");

  // The "Done" column's cards carry completion dates, so they land in Completed
  // rather than Later — completion outranks every other schedule state.
  await expect(cardTitles(lane(page, "completed"))).resolves.toEqual(
    expect.arrayContaining(["Scaffold Next.js app", "Configure Prisma + Postgres"]),
  );
});

test("Overdue refuses drops — a card gets there by time passing, not by choice", async ({
  page,
}) => {
  await openScheduleView(page);

  await expect(lane(page, "overdue")).toContainText("Cards arrive here on their own");
});

test("pausing a card moves it to Paused and survives a reload", async ({ page }) => {
  await openScheduleView(page);

  // "Design database schema" is seeded +7 days, so it starts in Later.
  const target = "Design database schema";
  await expect(cardTitles(lane(page, "later"))).resolves.toContain(target);

  await cardByTitle(page, target).getByRole("button", { name: "Pause" }).click();

  await expect.poll(() => cardTitles(lane(page, "paused"))).toContain(target);
  await expect.poll(() => cardTitles(lane(page, "later"))).not.toContain(target);

  await page.reload();
  await expect.poll(() => cardTitles(lane(page, "paused"))).toContain(target);

  // Resume puts it back where its date says it belongs, rather than leaving it
  // unscheduled — the point of keeping dueDate through a pause.
  await cardByTitle(page, target).getByRole("button", { name: "Resume" }).click();
  await expect.poll(() => cardTitles(lane(page, "later"))).toContain(target);
});

test("the toggle returns to the column view and the URL carries the choice", async ({
  page,
}) => {
  await openScheduleView(page);

  await page.getByTestId("group-column").click();
  await expect(page).toHaveURL(/\/board\/[^/?]+$/);
  await expect(page.getByTestId("board-column")).toHaveCount(3);
  await expect(page.getByTestId("due-lane")).toHaveCount(0);

  // The schedule view is linkable, not just reachable by clicking.
  await gotoReady(page, `${page.url()}?group=due`);
  await expect(page.getByTestId("due-lane")).toHaveCount(5);
});
