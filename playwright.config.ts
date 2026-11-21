import { defineConfig, devices } from "@playwright/test";

import path from "node:path";

/**
 * End-to-end tests drive a real browser against the app, the way a user does (D-031).
 * D-049: they run on their OWN dev server (port 3100) and their OWN database (concert_e2e),
 * seeded with fixture events by the global setup, so the developer's real local data is untouched.
 */
const E2E_PORT = 3100;
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://app:app@127.0.0.1:54329/concert_e2e";
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: path.resolve(__dirname, "tests/e2e/global-setup.ts"),
  fullyParallel: false,
  // One worker: the shared dev server times out under parallel cold compiles.
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/e2e/.report" }]],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next dev -H 127.0.0.1 -p ${E2E_PORT}`,
    // Readiness check on a page that never touches the database (it may not exist yet).
    url: `http://127.0.0.1:${E2E_PORT}/design`,
    reuseExistingServer: true,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      NEXT_DIST_DIR: ".next-e2e",
      APP_URL: `http://127.0.0.1:${E2E_PORT}`,
    },
    timeout: 120_000,
  },
});
