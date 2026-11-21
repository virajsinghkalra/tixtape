CREATE TYPE "public"."demand_kind" AS ENUM('view', 'search');--> statement-breakpoint
CREATE TABLE "city_demand" (
	"day" text NOT NULL,
	"city" text NOT NULL,
	"kind" "demand_kind" NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "city_demand_day_city_kind_pk" PRIMARY KEY("day","city","kind")
);
--> statement-breakpoint
CREATE INDEX "city_demand_day_idx" ON "city_demand" USING btree ("day");