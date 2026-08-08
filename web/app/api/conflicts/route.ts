import { badRequest } from "@/app/api/_lib/respond";
import { requireReviewerForApi } from "@/lib/server/auth";
import { loadQueue } from "@/lib/server/conflicts";
import { queueQuerySchema } from "@/types/queue";

/**
 * GET /api/conflicts — the filtered conflict queue.
 *
 * The console does not use this: every queue screen is a Server Component and
 * reads `loadQueue` directly, because a review queue that arrives after a
 * spinner is a worse review queue. This exists because the queue is the one
 * read worth having outside the browser — an ops script asking "what is still
 * escalated on run X" should not have to scrape HTML — and because it is the
 * documented surface in AGENTS.md § Web Route Handlers.
 *
 * Same schema, same loader as the screen, so a filter cannot mean two things.
 */
export async function GET(request: Request) {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = queueQuerySchema.safeParse(params);

  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid query.");
  }

  const load = await loadQueue(parsed.data);
  if (load.state === "no-runs") {
    return Response.json({ run: null, conflicts: [], total: 0, counts: null });
  }

  return Response.json({
    run: {
      id: load.run.id,
      status: load.run.status,
      sourceA: load.run.sourceAName,
      sourceB: load.run.sourceBName,
      ruleset: `${load.run.rulesetName} v${load.run.rulesetVersion}`,
    },
    counts: load.page.counts,
    total: load.page.total,
    page: load.page.page,
    pageCount: load.page.pageCount,
    conflicts: load.page.rows,
  });
}
