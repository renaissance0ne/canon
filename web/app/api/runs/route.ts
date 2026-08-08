import { badRequest, parseJson } from "@/app/api/_lib/respond";
import { requireReviewer } from "@/lib/server/auth";
import { appendAudit } from "@/lib/server/audit";
import { EngineUnreachableError, startRun } from "@/lib/server/engine";
import { createRun, failUndispatchedRun, listRuns } from "@/lib/server/runs";
import { getRuleset } from "@/lib/server/rulesets";
import { findSourceIds } from "@/lib/server/sources";
import { createRunSchema } from "@/types/run";

/**
 * Wireframe 1e — POST /api/runs.
 *
 * Returns { runId } immediately and never blocks on the pipeline. The run row
 * is inserted `queued`, the engine is handed the id, and the console polls
 * /api/runs/:runId/status from there.
 */

export async function GET() {
  return Response.json({ runs: await listRuns() });
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, createRunSchema);
  if (!parsed.ok) return parsed.response;

  const { sourceAId, sourceBId, rulesetId } = parsed.data;

  // Reconciling a source against itself would produce a perfect, meaningless
  // run: every entity matches itself and nothing ever disagrees.
  if (sourceAId === sourceBId) {
    return badRequest("Source A and Source B must be different systems.");
  }

  // The FKs would catch a missing id, but as a 500 with a constraint name in
  // it. The operator picked these from a dropdown; if one has since been
  // deleted, say so.
  const [found, ruleset] = await Promise.all([
    findSourceIds([sourceAId, sourceBId]),
    getRuleset(rulesetId),
  ]);
  if (!found.has(sourceAId)) return badRequest("Source A no longer exists.");
  if (!found.has(sourceBId)) return badRequest("Source B no longer exists.");
  if (!ruleset) return badRequest("That ruleset version no longer exists.");

  // Who started this. `actor` is resolved from the session, never from the
  // request body — an audit trail whose actor is whatever the client sent is
  // not an audit trail.
  const reviewer = await requireReviewer();

  const run = await createRun(parsed.data);

  await appendAudit({
    runId: run.id,
    action: "run_started",
    actor: reviewer.label,
    detail: {
      sourceAId,
      sourceBId,
      rulesetId,
      rulesetName: ruleset.name,
      rulesetVersion: ruleset.version,
    },
  });

  try {
    await startRun(run.id);
  } catch (cause) {
    if (!(cause instanceof EngineUnreachableError)) throw cause;

    // The run exists and the engine never took it. Record that ON THE ROW —
    // wireframe 1h is a state, not a toast, and it has to survive a reload.
    // The response is still 201: the run is real, it is just already failed,
    // and the console navigates to it and shows why.
    //
    // `stage=` follows the engine's own error convention so the failed-run
    // screen can highlight where it died without a second field on the row.
    await failUndispatchedRun(run.id, `EngineDispatch: ${cause.message}\nstage=dispatch`);
    await appendAudit({
      runId: run.id,
      action: "run_failed",
      actor: "web",
      detail: { stage: "dispatch", error: cause.message },
    });
  }

  return Response.json({ runId: run.id }, { status: 201 });
}
