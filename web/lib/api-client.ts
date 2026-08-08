/**
 * The browser's side of this app's own route handlers. Not server-only — this
 * is imported by Client Components, and it never talks to anything but
 * `/api/*` on the same origin. The engine is not reachable from here by design.
 */

/** What a route handler returns when Zod rejected the body. */
type ApiErrorBody = { error?: string; issues?: Record<string, string> };

export type PostResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; issues?: Record<string, string> };

export async function postJson<T>(url: string, body: unknown): Promise<PostResult<T>> {
  return sendJson<T>("POST", url, body);
}

/**
 * A review action (wireframe 1i, 1j, 1k, 1l). PATCH rather than POST because it
 * amends one existing resolution — the row is never replaced, and neither is
 * the agent's proposal on it.
 */
export async function patchJson<T>(url: string, body: unknown): Promise<PostResult<T>> {
  return sendJson<T>("PATCH", url, body);
}

async function sendJson<T>(
  method: "POST" | "PATCH",
  url: string,
  body: unknown,
): Promise<PostResult<T>> {
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and retry." };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload ?? {}) as ApiErrorBody;
    return {
      ok: false,
      // Field-level issues are shown next to the field; this is the fallback
      // line, and it must never be an empty string.
      message: error.error ?? `Request failed (${response.status}).`,
      issues: error.issues,
    };
  }

  return { ok: true, data: payload as T };
}
