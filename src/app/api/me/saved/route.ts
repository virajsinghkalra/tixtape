import { z } from "zod";
import { clampActionTime } from "@/domain/saved/sync";
import { ValidationError } from "@/lib/errors";
import { applySavedChanges, savedShowsOf } from "@/server/analytics";
import { json, parseBody, route } from "@/server/http";

/**
 * D-092: saved shows synced for a person who opted in with an email (D-090). Keyed by this
 * device's ID (a header on GET, so it never sits in a URL or access log). Anonymous devices get
 * `synced: false` and stay local-only. Never returns another person's data.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const Change = z.strictObject({ eventId: z.uuid(), at: z.iso.datetime({ offset: true }) });
const Post = z.strictObject({
  did: z.uuid(),
  saves: z.array(Change).max(50).default([]),
  removes: z.array(Change).max(50).default([]),
});
const Delete = z.strictObject({
  did: z.uuid(),
  eventId: z.uuid(),
  at: z.iso.datetime({ offset: true }),
});

const toChanges = (list: z.infer<typeof Change>[]) => {
  const now = new Date();
  return list.map((c) => ({ eventId: c.eventId, at: clampActionTime(new Date(c.at), now) }));
};

export const GET = route(async (req: Request) => {
  const did = z.uuid().safeParse(req.headers.get("x-tixtape-device"));
  if (!did.success) throw new ValidationError("Request is invalid.");
  return json(await savedShowsOf(req, did.data), 200, NO_STORE);
});

export const POST = route(async (req: Request) => {
  const body = await parseBody(req, Post);
  const synced = await applySavedChanges(req, body.did, {
    saves: toChanges(body.saves),
    removes: toChanges(body.removes),
  });
  return json({ synced }, 200, NO_STORE);
});

export const DELETE = route(async (req: Request) => {
  const body = await parseBody(req, Delete);
  const synced = await applySavedChanges(req, body.did, {
    saves: [],
    removes: toChanges([{ eventId: body.eventId, at: body.at }]),
  });
  return json({ synced }, 200, NO_STORE);
});
