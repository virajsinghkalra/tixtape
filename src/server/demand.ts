/**
 * D-081: counts visitor demand per city, privacy-safe: one counter per (IST day, city, kind).
 * No IP, user, session or query is stored. Recorded after the response is sent (`after`), and
 * a failure is only logged: analytics must never slow down or break a page.
 */
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { demandCity, type DemandKind } from "@/domain/gigs/demand";
import { PgCityDemandStore } from "@/infrastructure/gigs/pg-demand-stores";
import { container } from "@/server/container";
import { CITY_COOKIE, visitorCity } from "@/server/location";

export async function noteVisitorDemand(kind: DemandKind): Promise<void> {
  try {
    const found = visitorCity({
      headers: await headers(),
      cookie: (await cookies()).get(CITY_COOKIE)?.value,
    });
    const city = demandCity(found?.city);
    if (!city) return;
    after(async () => {
      const c = container();
      try {
        await new PgCityDemandStore(c.db).record(city, kind, c.clock.now());
      } catch (e) {
        c.logger.warn({ err: e }, "demand: failed to count a city visit");
      }
    });
  } catch {
    // Outside a request (tests, static rendering) there is nothing to count.
  }
}
