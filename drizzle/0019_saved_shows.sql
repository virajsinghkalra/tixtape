CREATE TABLE "saved_shows" (
	"person_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "saved_shows_person_id_event_id_pk" PRIMARY KEY("person_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "saved_shows" ADD CONSTRAINT "saved_shows_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_shows" ADD CONSTRAINT "saved_shows_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_shows_event_idx" ON "saved_shows" USING btree ("event_id");