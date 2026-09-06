import { parseJson } from "@/app/api/_lib/respond";
import { requireReviewerForApi } from "@/lib/server/auth";
import { createSource, listSources } from "@/lib/server/sources";
import { createSourceSchema } from "@/types/source";

/**
 * Wireframe 1c — POST /api/sources.
 *
 * `sources` is web-owned. The engine reads this table to learn what to connect
 * to and must never write it.
 *
 * Nothing secret is stored here: `createSourceSchema` accepts a name, a kind
 * and a non-secret config shape, and there is no field a credential could
 * travel in. Connection secrets live in `source_credentials`, encrypted
 * (AGENTS.md § Security Rules).
 *
 * The session requirement is enforced by `requireReviewerForApi()` on each
 * handler below, not by path matching in proxy.ts. Being signed in is only half
 * of it: the session also supplies the OWNER, and every query below is scoped
 * to it. A signed-in request is not a request for everyone's sources.
 */

export async function GET() {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;
  return Response.json({ sources: await listSources(gate.reviewer.userId) });
}

export async function POST(request: Request) {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const parsed = await parseJson(request, createSourceSchema);
  if (!parsed.ok) return parsed.response;

  // Owner from the session, never from the body — the same rule that governs
  // `audit_log.actor`.
  const source = await createSource(parsed.data, gate.reviewer.userId);
  return Response.json({ source }, { status: 201 });
}
