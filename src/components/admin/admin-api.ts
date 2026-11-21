/**
 * Browser calls to the admin API. Failures become one readable sentence: the admin never sees
 * raw JSON or a status code on its own.
 */
export type AdminResult<T> = { ok: true; data: T } | { ok: false; message: string };

type ErrorBody = { error?: { code?: unknown; message?: unknown; issues?: unknown } };

const FALLBACK: Record<number, string> = {
  401: "Your sign-in has expired. Sign in with Spotify again, then retry.",
  403: "This account isn't an admin.",
  404: "That item no longer exists. Refresh the page.",
  409: "Someone changed this in the meantime. Refresh the page and try again.",
};

function issueText(issues: unknown): string | null {
  if (!Array.isArray(issues)) return null;
  const parts = issues
    .map((i: unknown) => {
      if (typeof i !== "object" || i === null) return null;
      const { path, message } = i as { path?: unknown; message?: unknown };
      if (typeof message !== "string") return null;
      return typeof path === "string" && path !== "" ? `${path}: ${message}` : message;
    })
    .filter((s): s is string => s !== null)
    .slice(0, 3);
  return parts.length > 0 ? parts.join("; ") : null;
}

/** The message for a failed response, from its parsed body (anything) and status. */
export function failureMessage(status: number, body: unknown): string {
  const error =
    (typeof body === "object" && body !== null ? (body as ErrorBody).error : null) ?? {};
  const message = typeof error.message === "string" ? error.message : null;
  if (status === 400) {
    const issues = issueText(error.issues);
    return issues ? `Check the form. ${issues}.` : (message ?? "Check the form and try again.");
  }
  if (status === 401) return FALLBACK[401]!;
  if (message && status < 500) return message;
  return FALLBACK[status] ?? "Something went wrong on our side. Try again in a moment.";
}

export async function adminRequest<T>(
  url: string,
  method: "PATCH" | "POST",
  body: unknown,
): Promise<AdminResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check your connection and retry." };
  }
  const parsed: unknown = await res.json().catch(() => null);
  return res.ok
    ? { ok: true, data: parsed as T }
    : { ok: false, message: failureMessage(res.status, parsed) };
}
