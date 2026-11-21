import { parseBeacon } from "@/domain/analytics/beacon";
import { ValidationError } from "@/lib/errors";
import { acceptBeacon } from "@/server/analytics";
import { route } from "@/server/http";

/**
 * D-090: the product-analytics beacon. A batch of allow-listed events for one device
 * (`navigator.sendBeacon`, so the body is text). Answers 204 at once and stores after the
 * response; bots, Do Not Track / GPC and busy clients are dropped silently. Never stores an IP.
 */
export const POST = route(async (req: Request) => {
  const beacon = parseBeacon(await req.text());
  if (!beacon) throw new ValidationError("Request is invalid.");
  acceptBeacon(req, beacon);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
