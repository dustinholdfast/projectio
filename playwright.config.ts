// Playwright does not read .env on its own (Next and the Prisma CLI do), so load
// it here to pick up E2E_DATABASE_URL.
import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// End-to-end config. Tests run against a dedicated, freshly-reset Postgres
// database so they never touch the dev database and start from a known board
// state. `global-setup` resets + seeds it; the dev server is launched here with
// DATABASE_URL pointed at it (an existing process.env value wins over .env in
// Next, so this override takes effect).
//
// E2E_DATABASE_URL must be a throwaway database — global-setup drops every table
// in it. See .env.example for a local container to point it at.
const PORT = 3100;
const DATABASE_URL = process.env.E2E_DATABASE_URL;

// Where the console mailer mirrors outbound mail so the password-reset spec can
// read the link it was sent. Test-only; see lib/mailer.ts.
export const MAIL_OUTBOX_PATH = "e2e-outbox.jsonl";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    // global-setup throws first if E2E_DATABASE_URL is unset, so the fallback
    // here only keeps the config well-typed; it is never the effective value.
    env: {
      ...process.env,
      DATABASE_URL: DATABASE_URL ?? "",
      MAIL_OUTBOX_PATH,
    },
  },
});
