import { z } from "zod";
import { forgetDevice } from "@/server/analytics";
import { parseBody, route } from "@/server/http";

/**
 * D-090 (DPDP Act 2023, right to erasure): "Delete my data" on /privacy. Deletes this device's
 * person (nickname, name, email, consent) and every device linked to it, and anonymises their
 * events. Answers 204 whether or not anything was found, so it reveals nothing.
 */
const Body = z.strictObject({ did: z.uuid() });

export const DELETE = route(async (req: Request) => {
  const { did } = await parseBody(req, Body);
  await forgetDevice(req, did);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
