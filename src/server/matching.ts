/**
 * Artist Matching entry point for routes and jobs; wired in the container (D-004). One instance
 * per process; review candidates are kept in Postgres (D-016).
 */
import type { MatchingModule } from "@/application/matching";
import { container } from "@/server/container";

export function matching(): MatchingModule {
  return container().matching;
}
