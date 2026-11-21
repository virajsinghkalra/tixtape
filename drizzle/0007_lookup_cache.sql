CREATE TABLE "lookup_cache" (
	"lookup_id" text PRIMARY KEY NOT NULL,
	"query_key" text NOT NULL,
	"response" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lookup_cache_expires_idx" ON "lookup_cache" USING btree ("expires_at");