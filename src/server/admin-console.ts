/** Admin console entry point for admin pages and routes (P3.5); wired in the container (D-004). */
import type { AdminConsole } from "@/application/admin";
import { container } from "./container";

export function adminConsole(): AdminConsole {
  return container().adminConsole;
}
