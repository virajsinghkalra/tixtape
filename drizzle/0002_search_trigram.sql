-- D-042: fuzzy, typo-tolerant event search (type-ahead).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_title_trgm_idx" ON "events" USING gin (lower("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artists_normalized_name_trgm_idx" ON "artists" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venues_normalized_name_trgm_idx" ON "venues" USING gin ("normalized_name" gin_trgm_ops);
