import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import prettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Layer rules (see ENGINEERING.md §2):
 *   domain         -> imports nothing outside domain (and lib/result)
 *   application    -> may import domain and lib; never infrastructure or app
 *   infrastructure -> may import domain, application ports and lib; never app
 *   app (Next.js)  -> talks to the application layer through src/server/container.ts
 */
const layer = (files, patterns) => ({
  files,
  rules: { "no-restricted-imports": ["error", { patterns }] },
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
    },
  },
  layer(
    ["src/domain/**"],
    [
      {
        group: ["@/application/*", "@/infrastructure/*", "@/app/*", "@/server/*", "@/db/*"],
        message: "domain must stay pure: no application, infrastructure, db or framework imports.",
      },
      {
        group: ["next", "next/*", "react", "postgres", "drizzle-orm", "drizzle-orm/*", "pino"],
        message: "domain must not depend on frameworks or IO libraries.",
      },
    ],
  ),
  layer(
    ["src/application/**"],
    [
      {
        group: [
          "@/infrastructure/*",
          "@/app/*",
          "@/server/*",
          "@/db/*",
          "next",
          "next/*",
          "postgres",
          "drizzle-orm",
          "drizzle-orm/*",
        ],
        message:
          "application depends on ports (interfaces), not on infrastructure or the web framework.",
      },
    ],
  ),
  layer(
    ["src/infrastructure/**"],
    [
      {
        group: ["@/app/*", "@/server/*", "next", "next/*"],
        message: "infrastructure must not depend on the web layer.",
      },
    ],
  ),
  layer(
    ["src/app/**"],
    [
      {
        group: ["@/infrastructure/*", "@/db/*"],
        message:
          "routes and pages go through src/server/container.ts, never straight to infrastructure or the db.",
      },
    ],
  ),
  {
    // Browser test specs log diagnostics and poke at page internals; relax style rules there only.
    files: ["tests/**/*.spec.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  prettier,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "drizzle/**",
      "next-env.d.ts",
      "docs/**",
      "tests/**/*.d.ts",
      "tests/e2e/.report/**",
      ".next-e2e/**",
      "tests/qa/e2e/.results/**",
      "test-results/**",
    ],
  },
];

export default eslintConfig;
