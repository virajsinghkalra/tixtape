CREATE TABLE "event_stats" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"search_clicks" integer DEFAULT 0 NOT NULL,
	"playlist_opens" integer DEFAULT 0 NOT NULL,
	"trend_score" real DEFAULT 0 NOT NULL,
	"trend_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_normalized" text NOT NULL,
	"results_count" integer NOT NULL,
	"clicked_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_stats" ADD CONSTRAINT "event_stats_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_log" ADD CONSTRAINT "search_log_clicked_event_id_events_id_fk" FOREIGN KEY ("clicked_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_log_created_idx" ON "search_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "search_log_query_idx" ON "search_log" USING btree ("query_normalized");