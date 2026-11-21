import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "../../../playwright.config";

/** QA end-to-end config: same settings as the main config, but runs the QA specs only. */
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  // shared E2E DB setup first, then the QA-only safety and fixture tweaks
  globalSetup: [
    path.resolve(__dirname, "../../e2e/global-setup.ts"),
    path.resolve(__dirname, "qa-global-setup.ts"),
  ],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  // Outside the repo, so traces never trigger dev-server rebuilds mid-run.
  outputDir: "/tmp/concert-playlist-qa-results",
});
