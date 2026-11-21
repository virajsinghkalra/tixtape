---
name: ship-pointer
description: Lead workflow for taking a concert-playlist-app tracker pointer (P0.x–P4.x) from To do to Done: brief a dev subagent, verify, run independent QA, fix, record decisions and tick the tracker. Use when the user says 'build P2.1', 'start phase 2', 'next pointer', 'assign this to a team', or 'tick it in the tracker'.
---

# Ship a pointer

## Overview

The Lead (main Claude session) owns the pointer lifecycle defined in `docs/TEAMS.md`: To do → Building → Testing → Done. The tracker is the artifact https://claude.ai/artifact/9eSorm2kgoe4bGUjTLJt3o. Its rows live in the `tasks` collection of its database, one document per pointer id (e.g. `P2.1`), with fields `phase, order, title, detail, owner, status (todo|doing|testing|done|blocked), tests, updated`.

## Workflow

1. **Read state.** Read `docs/DECISIONS.md` (newest entries last) and the pointer row (`ArtifactData get tasks/<id>`; keep its `version` for `if_version`).
2. **Check dependencies.** Make sure the ports the pointer needs exist in `src/application/ports/`. If one is missing, write the port yourself first, so parallel teams code against a contract.
3. **Brief the dev agent** (Agent tool, `general-purpose`, background), using the matching module skill: `develop-spotify-module`, `develop-events-module`, `develop-matching-module`, `develop-playlist-engine` or `develop-web-ui`. The brief contains: the pointer ids, the LLD sections, the folders it owns, forbidden files, mandatory tests, and the hand-back format (status + test counts, public interface, wiring, proposed decisions, known limits). Set the tracker status to `doing`.
4. **Verify the hand-back yourself.** Run the agent's tests, plus `npm run lint` and `npm run typecheck`. Don't trust the reported counts.
5. **Record decisions.** Append new D-xxx entries to `docs/DECISIONS.md` (accept, reject or mark Proposed). Never renumber.
6. **Run QA:** follow `run-qa-signoff`. Set the status to `testing` with `tests: "Dev N passed · QA running"`.
7. **Fix loop.** Send QA bugs back to the same dev agent with SendMessage (QA never fixes product code). Re-run `tests/qa/<pointer>` yourself.
8. **Tick.** Set `status: "done"` and `tests: "Dev N · QA M passed (K bugs fixed)"` only when dev and QA tests are green, and, for user-facing pointers, after E2E passes (D-031).
9. **Wire.** Move the team's factory into `src/server/container.ts` and delete its temporary `src/server/<module>.ts` shim.
10. **Tell the user** in 3–5 lines: what was built, the test counts, and the bugs found and fixed.

## Common mistakes

- Ticking on dev tests alone. QA sign-off is mandatory (D-010).
- Letting two agents edit the same file. Give every agent disjoint folders.
- Committing or pushing without the user's go-ahead.
