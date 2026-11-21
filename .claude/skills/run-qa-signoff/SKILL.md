---
name: run-qa-signoff
description: Independent QA sign-off for a concert-playlist-app pointer: adversarial unit, integration, Playwright end-to-end and exploratory testing written from the spec and public interface only, never from the implementation. Use when a dev team hands back a pointer, when the user asks 'has QA tested this', 'test it like a real user', or before ticking anything Done.
---

# QA sign-off

## Principle

QA is a separate agent that **didn't build the code** (D-010, D-031). It reads the spec (`docs/LLD.md` sections, `docs/DECISIONS.md`, `ENGINEERING.md` §8) and **only the exported signatures** (`grep -n "^export" <file>`). It never reads function bodies, the dev team's tests or the dev team's fixtures. It never edits product code.

## Launching QA (Lead)

Spawn a `general-purpose` background agent with:

1. Which spec sections and decisions apply, and the public interface (signatures and route contracts) copied from the hand-back.
2. A list of spec rules to attack: boundaries (exact thresholds ±1), invalid and malicious input (unknown keys → 400 per D-018, huge, empty, Unicode, injection-like), failure injection (429/5xx/timeouts), concurrency and idempotency (run twice, double click), data integrity (no duplicate rows, D-029), security (tokens never in logs or responses, authz 401/403).
3. Output folders: `tests/qa/<pointer-group>/*.test.ts` and `*.int.test.ts`, and for user-facing work `tests/e2e/<flow>.spec.ts`.
4. Report format: totals; bugs `QA-<X>-n` with severity, rule, minimal repro, expected vs actual, file:line; ambiguities; a PASS/FAIL verdict per pointer.

## Levels

| Level         | How                                                                                                          | Command                         |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Unit/contract | own fakes, fixed clock                                                                                       | `npx vitest run tests/qa/<dir>` |
| Integration   | real Postgres (`npm run db:up`), msw for third parties                                                       | same                            |
| End-to-end    | Playwright drives Chromium (desktop + Pixel 7) against the app, which it starts itself; stub Spotify locally | `npm run test:e2e`              |
| Exploratory   | browse the app, take screenshots (`page.screenshot`), report confusing, broken or slow things                | report only                     |

## Rules

- Failing tests that show real violations stay in place, marked `// BUG: …`. They're findings, not noise.
- Spec ambiguities are reported separately. The Lead decides and records a D-xxx entry.
- After the dev team fixes bugs, re-run the same QA tests. Don't weaken them.
