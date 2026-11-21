import { z } from "zod";
import {
  CONTACT_SOURCES,
  EmailSchema,
  NicknameSchema,
  PersonNameSchema,
} from "@/domain/analytics/identity";
import { rememberContact, rememberNickname } from "@/server/analytics";
import { parseBody, route } from "@/server/http";

/**
 * D-090: opt-in identity for this device. Either a nickname, or an email with the consent box
 * ticked (`consent: true` is required: the only reason we keep an email is to email about gigs).
 * Answers 204 and never echoes what was sent; an email held by another device is left alone.
 */
const Body = z.union([
  z.strictObject({ did: z.uuid(), nickname: NicknameSchema }),
  z.strictObject({
    did: z.uuid(),
    name: PersonNameSchema.optional(),
    email: EmailSchema,
    consent: z.literal(true),
    source: z.enum(CONTACT_SOURCES),
  }),
]);

export const POST = route(async (req: Request) => {
  const body = await parseBody(req, Body);
  if ("nickname" in body) await rememberNickname(req, body.did, body.nickname);
  else
    await rememberContact(req, body.did, {
      email: body.email,
      personName: body.name ?? null,
      source: body.source,
    });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
