import { isUuid, notFound } from "@/app/api/_lib/respond";
import { requireReviewerForApi } from "@/lib/server/auth";
import { removeSource } from "@/lib/server/sources";

/**
 * DELETE /api/sources/:sourceId — remove a source.
 *
 * Deletes a source no run has read; archives one that runs have read, because
 * those runs, their decisions and their audit trail must stay readable (see
 * `removeSource`). The response says which happened, so the console can tell
 * the reviewer the truth about what is left.
 *
 * There is no request body to validate. The one input is the path id, checked
 * here as a uuid before it reaches a query, and scoped to the session's owner
 * inside `removeSource` — another account's source answers 404, exactly like a
 * source that never existed.
 */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/sources/[sourceId]">) {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const { sourceId } = await ctx.params;
  if (!isUuid(sourceId)) return notFound("No such source.");

  const result = await removeSource(sourceId, gate.reviewer.userId);
  if (!result) return notFound("No such source.");

  return Response.json(result);
}
