import { isUuid, notFound } from "@/app/api/_lib/respond";
import { requireReviewerForApi } from "@/lib/server/auth";
import { getRunDetail } from "@/lib/server/runs";

/** GET /api/runs/:runId — the run row, with the two sources and the policy version resolved. */
export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[runId]">) {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const { runId } = await ctx.params;
  if (!isUuid(runId)) return notFound("No such run.");

  const run = await getRunDetail(runId);
  return run ? Response.json({ run }) : notFound("No such run.");
}
