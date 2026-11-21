CREATE TABLE "ux_counters" (
	"day" text NOT NULL,
	"metric" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ux_counters_day_metric_pk" PRIMARY KEY("day","metric")
);
