ALTER TYPE "public"."event_source" ADD VALUE 'rollingstone';--> statement-breakpoint
ALTER TYPE "public"."event_source" ADD VALUE 'pollstar';--> statement-breakpoint
ALTER TYPE "public"."event_source" ADD VALUE 'wikipedia';--> statement-breakpoint
ALTER TYPE "public"."event_source" ADD VALUE 'sunburn';--> statement-breakpoint
ALTER TYPE "public"."event_source" ADD VALUE 'teaminnovation';--> statement-breakpoint
CREATE TABLE "event_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"source" "event_source" NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"payload" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_event_id" uuid
);
--> statement-breakpoint
ALTER TABLE "event_candidates" ADD CONSTRAINT "event_candidates_published_event_id_events_id_fk" FOREIGN KEY ("published_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_candidates_source_external_uq" ON "event_candidates" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "event_candidates_dedupe_idx" ON "event_candidates" USING btree ("dedupe_key");