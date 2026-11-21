CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid,
	"name" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"city" text,
	"source" text NOT NULL,
	"utm_medium" text,
	"utm_campaign" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"first_source" text NOT NULL,
	"person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nickname" text,
	"name" text,
	"email" text,
	"consent_at" timestamp with time zone,
	"consent_version" text,
	"consent_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_at_device_idx" ON "analytics_events" USING btree ("at","device_id");--> statement-breakpoint
CREATE INDEX "analytics_events_name_at_idx" ON "analytics_events" USING btree ("name","at");--> statement-breakpoint
CREATE INDEX "analytics_events_device_at_idx" ON "analytics_events" USING btree ("device_id","at");--> statement-breakpoint
CREATE INDEX "devices_person_idx" ON "devices" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "devices_first_seen_idx" ON "devices" USING btree ("first_seen");--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_uq" ON "people" USING btree ("email");