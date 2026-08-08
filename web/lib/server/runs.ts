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
 */

/** The two source rows are joined twice, so each side needs its own alias. */
const sourceA = aliasedTable(sources, "source_a");
const sourceB = aliasedTable(sources, "source_b");

const detailColumns = {
  id: runs.id,
  sourceAId: runs.sourceAId,
  sourceBId: runs.sourceBId,
  rulesetId: runs.rulesetId,
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
export async function listRuns(limit = 50): Promise<RunDetail[]> {
  await connection();

  const rows = await getDb()
    .select(detailColumns)
    .from(runs)
    .innerJoin(sourceA, eq(runs.sourceAId, sourceA.id))
    .innerJoin(sourceB, eq(runs.sourceBId, sourceB.id))
    .innerJoin(rulesets, eq(runs.rulesetId, rulesets.id))
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
export async function getLatestRunWithConflicts(): Promise<RunDetail | null> {
  await connection();

  const [row] = await getDb()
    .select(detailColumns)
    .from(runs)
    .innerJoin(sourceA, eq(runs.sourceAId, sourceA.id))
    .innerJoin(sourceB, eq(runs.sourceBId, sourceB.id))
    .innerJoin(rulesets, eq(runs.rulesetId, rulesets.id))
    .innerJoin(conflicts, eq(conflicts.runId, runs.id))
    .orderBy(desc(runs.startedAt))
    .limit(1);

  return row ? runDetailSchema.parse(row) : null;
}

export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  await connection();

  const [row] = await getDb()
    .select(detailColumns)
    .from(runs)
    .innerJoin(sourceA, eq(runs.sourceAId, sourceA.id))
    .innerJoin(sourceB, eq(runs.sourceBId, sourceB.id))
    .innerJoin(rulesets, eq(runs.rulesetId, rulesets.id))
    .where(eq(runs.id, runId))
    .limit(1);

  return row ? runDetailSchema.parse(row) : null;
}

/** The bare row, without the joins. Used by the polled status route. */
export async function getRun(runId: string): Promise<Run | null> {
  await connection();

  const [row] = await getDb().select().from(runs).where(eq(runs.id, runId)).limit(1);
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
 */
export async function createRun(input: CreateRun): Promise<Run> {
  const [row] = await getDb()
    .insert(runs)
    .values({ ...input, status: "queued", stats: EMPTY_RUN_STATS })
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
