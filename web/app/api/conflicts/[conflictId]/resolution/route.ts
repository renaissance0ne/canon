import { isUuid, notFound, parseJson } from "@/app/api/_lib/respond";
import { requireReviewer } from "@/lib/server/auth";
import { recordReview } from "@/lib/server/conflicts";
import { reviewActionSchema } from "@/types/resolution";

/**
 * PATCH /api/conflicts/:conflictId/resolution — approve | reject | override.
 *
 * Wireframes 1i, 1j, 1k and 1l. Every one of the three appends to `audit_log`;
 * nothing here is a silent change, and the agent's proposal is never deleted or
 * rewritten — a reviewer's decision sits next to it.
 *
 * Two things are resolved server-side and cannot be sent in:
 *
 *   the reviewer   from the session, because "who approved this" is the question
 *                  the audit trail exists to answer
 *   the value      an override must be one of the two observed values or a legal
 *                  normalization of one, the same check the engine's `validate`
 *                  node applies to the model
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/conflicts/[conflictId]/resolution">,
) {
  const { conflictId } = await ctx.params;
  if (!isUuid(conflictId)) return notFound("No such conflict.");

  const parsed = await parseJson(request, reviewActionSchema);
  if (!parsed.ok) return parsed.response;

  const reviewer = await requireReviewer();
  const result = await recordReview({
    conflictId,
    action: parsed.data,
    reviewer,
  });

  if (!result.ok) {
    return Response.json({ error: result.message }, { status: result.code });
  }

  return Response.json({
    conflictId,
    status: result.status,
    reviewedBy: reviewer.label,
  });
}
