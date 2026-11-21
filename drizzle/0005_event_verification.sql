CREATE TYPE "public"."event_visibility" AS ENUM('held', 'published', 'archived');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "visibility" "event_visibility" DEFAULT 'held' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "confidence" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "verification" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "events_visibility_idx" ON "events" USING btree ("visibility","starts_at");