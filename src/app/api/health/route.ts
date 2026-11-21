import { checkHealth } from "@/server/health";

export const dynamic = "force-dynamic";

/** D-084: uptime probe. 200 when the database answers, 503 when it doesn't. Never cached. */
export async function GET(): Promise<Response> {
  const health = await checkHealth();
  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
