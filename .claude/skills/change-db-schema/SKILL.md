---
name: change-db-schema
description: Safely change the Postgres schema of concert-playlist-app with Drizzle - add tables, columns, enums or constraints, generate and apply a migration, and keep the no-duplicate-data rules. Use when a team proposes a schema change, adding a table like artist_match_candidates, adding an enum value, or adding a unique constraint.
---

# Change the database schema

## Rules (D-014, D-029, ENGINEERING.md §6, §10)

- **Only the Lead edits `src/db/schema.ts`.** Teams propose; the Lead applies.
- **Every new entity gets a natural key with a unique constraint.** Writes to it are upserts.
- **Never edit an applied migration.** Always generate a new one.
- **Use timestamps in UTC** (`timestamp(..., { withTimezone: true })`). Foreign keys get explicit `onDelete`.
- **Add an index for every column used in a filter or join on a growing table.**

## Steps

1. Record the decision in `docs/DECISIONS.md` (Accepted).
2. Edit `src/db/schema.ts`. Import enums from `src/domain/shared/lineup.ts` so domain and DB share one list.
3. `npx drizzle-kit generate --name short_name`, then review the new `drizzle/NNNN_short_name.sql` by hand. Watch for drops and NOT NULL without a default on existing tables.
4. `npm run db:up && npm run db:migrate` (dev DB). The integration test DB is rebuilt automatically on each `vitest` run.
5. Update affected repositories and their `*.int.test.ts`. Add a test that proves the unique constraint rejects a duplicate.
6. Run `npm run lint && npm run typecheck && npm test`.

## Adding an enum value

Postgres `ALTER TYPE ... ADD VALUE` can't run inside some transactions. Check the generated SQL and split it into its own migration if needed.

## Common mistakes

- Adding a column that copies a fact from another table. Join instead (§10.5).
- Forgetting `ON CONFLICT` in the repository after adding a unique key, so retries turn into 500s.
