import { parseJson } from "@/app/api/_lib/respond";
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
 * travel in. Connection secrets live in the engine's environment keyed by
 * `kind` (AGENTS.md § Security Rules).
 *
 * The session requirement is enforced by proxy.ts, which matches /api/*.
 */

export async function GET() {
  return Response.json({ sources: await listSources() });
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, createSourceSchema);
  if (!parsed.ok) return parsed.response;

  const source = await createSource(parsed.data);
  return Response.json({ source }, { status: 201 });
}
