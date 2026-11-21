import { defineConfig } from "@playwright/test";
import base from "../../../playwright.config";

/** QA end-to-end config: same settings as the main config, but runs the QA specs only. */
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  // Outside the repo, so traces never trigger dev-server rebuilds mid-run.
  outputDir: "/tmp/concert-playlist-qa-results",
});
