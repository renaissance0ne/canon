import { badRequest, parseJson } from "@/app/api/_lib/respond";
import { requireReviewerForApi } from "@/lib/server/auth";
import { appendAudit } from "@/lib/server/audit";
import { EngineUnreachableError, startRun } from "@/lib/server/engine";
import { createRun, failUndispatchedRun, listRuns } from "@/lib/server/runs";
import { getRuleset } from "@/lib/server/rulesets";
import { getSource } from "@/lib/server/sources";
import { credentialsMissingFor } from "@/lib/server/credentials";
import { createRunSchema } from "@/types/run";

/**
 * Wireframe 1e — POST /api/runs.
 *
 * Returns { runId } immediately and never blocks on the pipeline. The run row
 * is inserted `queued`, the engine is handed the id, and the console polls
 * /api/runs/:runId/status from there.
 */

export async function GET() {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;
  return Response.json({ runs: await listRuns(gate.reviewer.userId) });
}

export async function POST(request: Request) {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const parsed = await parseJson(request, createRunSchema);
  if (!parsed.ok) return parsed.response;

  const { sourceAId, sourceBId, rulesetId, modelProvider } = parsed.data;

  // Who started this. `actor` and `ownerId` are both resolved from the session,
  // never from the request body — an audit trail whose actor is whatever the
  // client sent is not an audit trail, and a run whose owner is whatever the
  // client sent is not a boundary.
  const reviewer = gate.reviewer;

  // Reconciling a source against itself would produce a perfect, meaningless
  // run: every entity matches itself and nothing ever disagrees.
  if (sourceAId === sourceBId) {
    return badRequest("Source A and Source B must be different systems.");
  }

  // The FKs would catch a missing id, but as a 500 with a constraint name in
  // it. The operator picked these from a dropdown; if one has since been
  // deleted, say so.
  //
  // Loaded in full rather than existence-checked, because the credential gate
  // below needs each source's kind and name to say anything useful.
  //
  // These three scoped reads are ALSO the ownership check on the run itself.
  // The foreign keys on `runs` will happily accept another account's sourceId
  // — they constrain existence, not ownership — so a run built from ids the
  // client supplied is only this account's run because each id was resolved
  // here, against this account. "No longer exists" is the honest answer for a
  // source belonging to someone else: from here, it does not.
  const [sourceA, sourceB, ruleset] = await Promise.all([
    getSource(sourceAId, reviewer.userId),
    getSource(sourceBId, reviewer.userId),
    getRuleset(rulesetId, reviewer.userId),
  ]);
  if (!sourceA) return badRequest("Source A no longer exists.");
  if (!sourceB) return badRequest("Source B no longer exists.");
  if (!ruleset) return badRequest("That ruleset version no longer exists.");

  // A run that starts and dies at the extract step because nobody connected
  // Salesforce burns the whole pipeline and leaves a failed row to explain.
  // Checking here makes it a 400 on the button press instead — and names the
  // source, so the fix is one click away rather than a hunt.
  const unconnected = await credentialsMissingFor([sourceA, sourceB], reviewer.userId);
  if (unconnected.length > 0) {
    return badRequest(
      `${unconnected.join(" and ")} ${unconnected.length === 1 ? "has" : "have"} no stored ` +
        `credentials. Connect ${unconnected.length === 1 ? "it" : "them"} before starting a run.`,
    );
  }

  const run = await createRun(parsed.data, reviewer.userId);

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
      // What this run will resolve with. In the trail as well as on the row,
      // because reading the audit log must not require joining back to a
      // column a later migration could default away.
      modelProvider,
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
