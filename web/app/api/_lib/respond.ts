import "server-only";
import type { ZodType } from "zod";

export { isUuid } from "@/lib/uuid";

/**
 * Shared route-handler plumbing.
 *
 * AGENTS.md: every route handler validates its body with Zod before touching
 * the database, no exceptions. This file is what makes that one line at each
 * call site instead of eight, so there is no incentive to skip it.
 */

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Parse and validate a JSON body. On failure the caller returns `response`. */
export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<Parsed<T>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false, response: badRequest("Body must be JSON.") };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      ok: false,
      response: Response.json(
        { error: "Invalid request body.", issues: fieldIssues(result.error.issues) },
        { status: 400 },
      ),
    };
  }

  return { ok: true, data: result.data };
}

type Issue = { path: PropertyKey[]; message: string };

/** `{ "config.objects": "..." }` — addressable by the form field that caused it. */
function fieldIssues(issues: readonly Issue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    out[issue.path.map(String).join(".") || "_"] = issue.message;
  }
  return out;
}

export function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

export function notFound(error: string): Response {
  return Response.json({ error }, { status: 404 });
}
