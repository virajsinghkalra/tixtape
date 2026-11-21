CREATE TYPE "public"."gate_verdict" AS ENUM('publish', 'hold', 'reject');--> statement-breakpoint
CREATE TYPE "public"."publish_action" AS ENUM('published', 'updated', 'held', 'reverified');--> statement-breakpoint
ALTER TYPE "public"."event_source" ADD VALUE 'highape';--> statement-breakpoint
ALTER TYPE "public"."event_source" ADD VALUE 'artist_site';--> statement-breakpoint
ALTER TYPE "public"."event_source" ADD VALUE 'gig_web';--> statement-breakpoint
CREATE TABLE "gate_decisions" (
	"night_key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"night" text NOT NULL,
	"city" text NOT NULL,
	"headliner" text NOT NULL,
	"decision" "gate_verdict" NOT NULL,
	"reasons" jsonb NOT NULL,
	"checks" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"event_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gig_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artist" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"night_key" text NOT NULL,
	"action" "publish_action" NOT NULL,
	"actor" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"changes" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_audit" ADD CONSTRAINT "publish_audit_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gate_decisions_decision_idx" ON "gate_decisions" USING btree ("decision","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gig_leads_url_uq" ON "gig_leads" USING btree ("url");--> statement-breakpoint
CREATE INDEX "gig_leads_last_seen_idx" ON "gig_leads" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "publish_audit_action_at_idx" ON "publish_audit" USING btree ("action","at");--> statement-breakpoint
CREATE INDEX "publish_audit_event_idx" ON "publish_audit" USING btree ("event_id");