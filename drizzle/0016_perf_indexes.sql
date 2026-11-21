CREATE INDEX "event_artists_artist_idx" ON "event_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "event_sources_event_idx" ON "event_sources" USING btree ("event_id");