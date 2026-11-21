/** Events & Ingestion entry point for routes and jobs; wired in the container (D-004). */
import type { EventsModule } from "@/infrastructure/events-module";
import { container } from "./container";

export function events(): EventsModule {
  return container().events;
}

export { clientKey } from "./client-key";
