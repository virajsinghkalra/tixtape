import { z } from "zod";
import { isUxEvent, VITALS, vitalMetric, type UxEvent } from "@/domain/ux/counters";
import { parseBody, route } from "@/server/http";
import { noteUx } from "@/server/ux";

/**
 * D-084 (OD-4): the browser's aggregate UX beacon. Either one allow-listed event
 * (`{ metric }`) or one web vital (`{ vital, value, path }`, stored only as route group and
 * rating). Answers 204 and stores no IP, id or path.
 */
const Body = z.union([
  z.strictObject({ metric: z.string().max(40).refine(isUxEvent) }),
  z.strictObject({
    vital: z.enum(VITALS),
    value: z.number().nonnegative().max(600_000),
    path: z.string().max(300).startsWith("/"),
  }),
]);

export const POST = route(async (req: Request) => {
  const body = await parseBody(req, Body);
  noteUx(
    "vital" in body ? vitalMetric(body.vital, body.value, body.path) : (body.metric as UxEvent), // validated by isUxEvent above
  );
  return new Response(null, { status: 204 });
});
