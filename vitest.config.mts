import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/qa/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "node_modules/**"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts", "tests/qa/**/*.int.test.ts"],
          environment: "node",
          globalSetup: ["tests/setup/integration-global.ts"],
          // One shared database: run files one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/app/**", "src/**/*.test.ts"] },
  },
});
