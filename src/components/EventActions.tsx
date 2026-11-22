import type { EventDetail } from "@/application/ports/events";
import { calendarEventOf, googleCalendarUrl } from "@/domain/events/calendar";
import { env } from "@/lib/env";
import { RemindMe } from "./RemindMe";
import { SaveButton } from "./SaveButton";

/**
 * The Features team's event-page actions (UX #2, #12; D-088), mounted with one line in the
 * event header's button row: "Remind me 🔔" and "♡ Save". Server-rendered links, so the .ics
 * link works before any script loads.
 */
export function EventActions({ event }: { event: EventDetail }) {
  const origin = new URL(env().APP_URL).origin;
  const google = googleCalendarUrl(calendarEventOf(event, origin));
  return (
    <>
      <RemindMe
        eventId={event.id}
        icsHref={`/api/events/${event.id}/calendar.ics`}
        googleHref={google}
      />
      <SaveButton
        remind={{ icsHref: `/api/events/${event.id}/calendar.ics`, googleHref: google }}
        show={{
          id: event.id,
          title: event.title,
          startsAt: event.startsAt.toISOString(),
          city: event.venue?.city ?? null,
        }}
      />
    </>
  );
}
