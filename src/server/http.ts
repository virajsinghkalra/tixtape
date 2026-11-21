/**
 * The web boundary. Every route handler is wrapped in `route()` so errors map to
 * HTTP responses the same way everywhere (ENGINEERING.md §4).
 */
import { ZodError, type ZodType } from "zod";
import { isAppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { timed, withServerTiming } from "@/lib/server-timing";

export type ErrorBody = { error: { code: string; message: string; issues?: unknown } };

/**
 * D-086: for public reads that depend only on the URL (no cookies, no user). Vercel's edge
 * serves them for 60 s, then up to 5 min stale while one request refreshes in the background,
 * so most hits never reach the function in Singapore. Never for anything logged or per user.
 */
export const EDGE_CACHE_SHORT = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
} as const;

export function json<T>(body: T, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export function route<Ctx>(
  handler: (req: Request, ctx: Ctx) => Promise<Response>,
): (req: Request, ctx: Ctx) => Promise<Response> {
  const handle = errorsToResponses(handler);
  // D-086: every route reports where its time went (db, db-connect, total).
  return (req, ctx) => timed(async () => withServerTiming(await handle(req, ctx)));
}

function errorsToResponses<Ctx>(
  handler: (req: Request, ctx: Ctx) => Promise<Response>,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof ValidationError) {
        return json<ErrorBody>(
          { error: { code: e.code, message: e.message, issues: e.issues } },
          400,
        );
      }
      if (isAppError(e)) {
        if (e.httpStatus >= 500) logger.error({ err: e }, "route failed");
        return json<ErrorBody>({ error: { code: e.code, message: e.message } }, e.httpStatus);
      }
      logger.error({ err: e }, "unhandled route error");
      return json<ErrorBody>(
        { error: { code: "internal", message: "Something went wrong. Try again in a moment." } },
        500,
      );
    }
  };
}

/** Parse and validate a JSON body, turning Zod issues into a ValidationError. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  return parseWith(schema, raw);
}

export function parseWith<T>(schema: ZodType<T>, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) {
      throw new ValidationError(
        "Request is invalid.",
        e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    throw e;
  }
}
