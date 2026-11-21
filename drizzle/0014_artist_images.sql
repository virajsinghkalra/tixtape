ALTER TABLE "artists" ADD COLUMN "alt_image_url" text;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "alt_image_credit" text;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "alt_image_source" text;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "alt_image_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "poster_credit" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "poster_source" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "poster_checked_at" timestamp with time zone;