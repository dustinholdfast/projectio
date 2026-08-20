import type { Page } from "@playwright/test";

/**
 * Navigate to `path` and wait until the page is actually interactive.
 *
 * `next dev` compiles routes on demand, so the first visit to one serves HTML
 * well before its JavaScript is ready. A click that lands in that window is
 * silently lost: the form submits natively, without the header Next needs to
 * recognise a server action, so the action never runs and the page simply
 * re-renders unchanged — no error, no navigation.
 *
 * Only the first test to reach a route pays this, which made it look like a flake
 * confined to whichever spec happened to run first. Waiting for the network to
 * settle waits for hydration and removes the race.
 *
 * In production this window is far smaller (nothing is compiled on demand), but
 * it is not zero — see AGENTS.md.
 */
export async function gotoReady(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/**
 * Wait for the page a sign-in just navigated to.
 *
 * The same on-demand compilation applies to routes reached by *navigating*, not
 * just by `goto`: signing in lands on `/` (Focus), and the first spec to get there waits
 * for it to build. Without this, the next click races that compile — which made
 * specs pass in the full suite (an earlier spec had already warmed the route) and
 * fail when run alone.
 */
export async function waitForLanding(page: Page): Promise<void> {
  await page.waitForURL(/\/$/);
  await page.waitForLoadState("networkidle");
}

/** The board list used to be `/`. Focus took that slot; the list is `/boards`. */
export async function gotoBoards(page: Page): Promise<void> {
  await gotoReady(page, "/boards");
}
