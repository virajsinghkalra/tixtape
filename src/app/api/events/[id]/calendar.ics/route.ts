import { parseEventId } from "@/application/events";
import { buildIcs, calendarEventOf, icsFileName } from "@/domain/events/calendar";
import { env } from "@/lib/env";
import { events } from "@/server/events";
import { route } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/events/:id/calendar.ics (UX #2, D-088). Public. One VEVENT with a stable UID, so
 * re-adding after a change updates the entry. Alarms a day and 3 hours before. Timed shows are
 * in UTC; date-only shows are all-day on their IST dates. Held, archived or unknown: 404.
 */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const event = await events().getEvent(parseEventId(id));
  const origin = new URL(env().APP_URL).origin;
  return new Response(buildIcs(calendarEventOf(event, origin), new Date()), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${icsFileName(event.title)}"`,
      // Times can change; a short shared cache is plenty.
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
});
