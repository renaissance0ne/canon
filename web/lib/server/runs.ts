import "server-only";
import { connection } from "next/server";
import { aliasedTable, and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conflicts, rulesets, runs, sources } from "@/lib/db/schema";
import {
  EMPTY_RUN_STATS,
  runDetailSchema,
  runSchema,
  type CreateRun,
  type Run,
  type RunDetail,
  type RunStatus,
} from "@/types/run";
import {
  EMPTY_SEVERITY_BREAKDOWN,
  severitySchema,
  type SeverityBreakdown,
} from "@/types/conflict";

/**
 * SERVER ONLY — run queries.
 *
 * `runs` is the one shared-write table: the web layer creates the row, the
 * engine advances `status` and `stats` as the pipeline moves. Nothing here ever
 * writes `entities`, `matches` or `conflicts` — those are engine-owned, and the
 * web layer reading them is the whole point of the split.
 *
 * `runs` is also the ownership root for everything the engine writes. Entities,
 * matches, conflicts, resolutions and audit entries carry no owner of their
 * own; they are this account's because their `runId` is. So every function that
 * resolves a run takes a required `ownerId`, and every derived read downstream
 * is safe precisely because the run it was handed had already been scoped here.
 * Do not add a run lookup that skips it.
 */

/** The two source rows are joined twice, so each side needs its own alias. */
const sourceA = aliasedTable(sources, "source_a");
const sourceB = aliasedTable(sources, "source_b");

const detailColumns = {
  id: runs.id,
  sourceAId: runs.sourceAId,
  sourceBId: runs.sourceBId,
  rulesetId: runs.rulesetId,
  modelProvider: runs.modelProvider,
  status: runs.status,
  stats: runs.stats,
  error: runs.error,
  startedAt: runs.startedAt,
  finishedAt: runs.finishedAt,
  sourceAName: sourceA.name,
  sourceBName: sourceB.name,
  rulesetName: rulesets.name,
  rulesetVersion: rulesets.version,
};

/** Newest first. A run list is read for "what happened last", every time. */
export async function listRuns(ownerId: string, limit = 50): Promise<RunDetail[]> {
  await connection();

  const rows = await getDb()
    .select(detailColumns)
    .from(runs)
    .innerJoin(sourceA, eq(runs.sourceAId, sourceA.id))
    .innerJoin(sourceB, eq(runs.sourceBId, sourceB.id))
    .innerJoin(rulesets, eq(runs.rulesetId, rulesets.id))
    .where(eq(runs.ownerId, ownerId))
    .orderBy(desc(runs.startedAt))
    .limit(limit);

  return rows.map((row) => runDetailSchema.parse(row));
}

/**
 * What the conflict queue opens on when no run is named in the URL.
 *
 * The most recent run that actually detected something — not simply the most
 * recent run. Landing a reviewer on an empty queue because someone kicked off a
 * run thirty seconds ago is a worse default than showing them the work that is
 * still waiting.
 */
export async function getLatestRunWithConflicts(ownerId: string): Promise<RunDetail | null> {
  await connection();

  const [row] = await getDb()
    .select(detailColumns)
    .from(runs)
    .innerJoin(sourceA, eq(runs.sourceAId, sourceA.id))
    .innerJoin(sourceB, eq(runs.sourceBId, sourceB.id))
    .innerJoin(rulesets, eq(runs.rulesetId, rulesets.id))
    .innerJoin(conflicts, eq(conflicts.runId, runs.id))
    .where(eq(runs.ownerId, ownerId))
    .orderBy(desc(runs.startedAt))
    .limit(1);

  return row ? runDetailSchema.parse(row) : null;
}

/**
 * Null for a run this account does not own, exactly as for one that does not
 * exist. Callers turn both into the same 404 — see the note in sources.ts.
 */
export async function getRunDetail(runId: string, ownerId: string): Promise<RunDetail | null> {
  await connection();

  const [row] = await getDb()
    .select(detailColumns)
    .from(runs)
    .innerJoin(sourceA, eq(runs.sourceAId, sourceA.id))
    .innerJoin(sourceB, eq(runs.sourceBId, sourceB.id))
    .innerJoin(rulesets, eq(runs.rulesetId, rulesets.id))
    .where(and(eq(runs.id, runId), eq(runs.ownerId, ownerId)))
    .limit(1);

  return row ? runDetailSchema.parse(row) : null;
}

/** The bare row, without the joins. Used by the polled status route. */
export async function getRun(runId: string, ownerId: string): Promise<Run | null> {
  await connection();

  const [row] = await getDb()
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.ownerId, ownerId)))
    .limit(1);

  return row ? runSchema.parse(row) : null;
}

/**
 * Create the run row and hand back its id. Status starts at `queued` and stats
 * start at zero — the engine owns every number in there from this point on.
 *
 * Dispatch to the engine is deliberately NOT part of this function. A run that
 * exists in Postgres but never reached the engine is a recoverable, visible
 * state (wireframe 1h); a dispatch that succeeded against a row that failed to
 * insert is not.
 *
 * `ownerId` is from the session. The caller must ALSO have checked that both
 * sources and the ruleset belong to that owner — the FKs will happily point a
 * run at someone else's source, and this insert is not the place that catches
 * it. POST /api/runs does, by loading each one scoped.
 */
export async function createRun(input: CreateRun, ownerId: string): Promise<Run> {
  const [row] = await getDb()
    .insert(runs)
    .values({ ...input, ownerId, status: "queued", stats: EMPTY_RUN_STATS })
    .returning();

  return runSchema.parse(row);
}

/**
 * Record a terminal failure the web layer caused — currently only "the engine
 * never accepted this run". The engine records its own failures directly.
 *
 * Guarded on `queued`: once the engine has moved the run on, its status is the
 * engine's to write, and a late dispatch error must not overwrite real
 * progress.
 */
export async function failUndispatchedRun(runId: string, error: string): Promise<void> {
  await getDb()
    .update(runs)
    .set({ status: "failed" satisfies RunStatus, error, finishedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.status, "queued")));
}

/**
 * Conflicts per severity level — the histogram in wireframe 1g, and the handoff
 * into review: what a reviewer sees here is what they are about to work.
 *
 * Reads an engine-owned table. Empty until the detect stage has run, which is
 * why the caller renders the histogram only for a complete run.
 *
 * Scoped by the run it is given, not by an owner of its own: `conflicts` has no
 * owner column, and the only legitimate way to reach this is with a `runId`
 * that `getRunDetail` already resolved for this account.
 */
export async function getSeverityBreakdown(runId: string): Promise<SeverityBreakdown> {
  await connection();

  const rows = await getDb()
    .select({ severity: conflicts.severity, total: count() })
    .from(conflicts)
    .where(eq(conflicts.runId, runId))
    .groupBy(conflicts.severity);

  const breakdown: SeverityBreakdown = { ...EMPTY_SEVERITY_BREAKDOWN };
  for (const row of rows) {
    // A severity outside 1..4 is an engine bug, not something to render. Drop
    // it rather than widening the histogram to accommodate bad data.
    const severity = severitySchema.safeParse(row.severity);
    if (severity.success) breakdown[severity.data] = row.total;
  }
  return breakdown;
}
