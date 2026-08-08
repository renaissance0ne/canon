import { z } from "zod";

/** Tool contract — mirrors engine/pipeline/schema.py. */
export const runStatusSchema = z.enum([
  "queued",
  "extracting",
  "matching",
  "detecting",
  "resolving",
  "complete",
  "failed",
]);

export const runStatsSchema = z.object({
  entitiesA: z.number().int().nonnegative(),
  entitiesB: z.number().int().nonnegative(),
  candidatePairs: z.number().int().nonnegative(),
  matches: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  autoResolved: z.number().int().nonnegative(),
  escalated: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
});

export const createRunSchema = z.object({
  /** The CRM side. */
  sourceAId: z.string().uuid(),
  /** The warehouse side. */
  sourceBId: z.string().uuid(),
  rulesetId: z.string().uuid(),
});

export const runSchema = createRunSchema.extend({
  id: z.string().uuid(),
  status: runStatusSchema,
  stats: runStatsSchema,
  error: z.string().nullable(),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
});

/**
 * What GET /api/runs/:runId returns. The ids alone are unreadable in a console —
 * a run is identified by the two systems it reconciled and the policy version it
 * ran under, so the names are resolved server-side and travel with the row.
 */
export const runDetailSchema = runSchema.extend({
  sourceAName: z.string(),
  sourceBName: z.string(),
  rulesetName: z.string(),
  /** The version this run executed. Rulesets are versioned, never edited. */
  rulesetVersion: z.number().int().positive(),
});

/**
 * POST {ENGINE_URL}/runs — the engine reads sources and ruleset from Postgres
 * using runId. Configuration is never passed over the wire: two sources of
 * truth for what a run executed would break reproducibility.
 */
export const engineStartRunRequestSchema = z.object({ runId: z.string().uuid() });
export const engineStartRunResponseSchema = z.object({
  runId: z.string().uuid(),
  accepted: z.literal(true),
});

/** GET {ENGINE_URL}/runs/:runId/status */
export const engineRunStatusSchema = z.object({
  runId: z.string().uuid(),
  status: runStatusSchema,
  stats: runStatsSchema,
  error: z.string().nullable(),
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunStats = z.infer<typeof runStatsSchema>;
export type CreateRun = z.infer<typeof createRunSchema>;
export type Run = z.infer<typeof runSchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
export type EngineRunStatus = z.infer<typeof engineRunStatusSchema>;

/**
 * The pipeline, in order. This is the status bar in wireframes 1f and 1h: a run
 * only ever moves forward through these, and "failed" is not a stage — it is a
 * terminal state that replaces whichever stage was current when it happened.
 */
export const RUN_STAGES = [
  "queued",
  "extracting",
  "matching",
  "detecting",
  "resolving",
  "complete",
] as const satisfies readonly RunStatus[];

export type RunStage = (typeof RUN_STAGES)[number];

/** No further polling. `failed` is terminal too — a failed run never resumes. */
export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "complete" || status === "failed";
}

/**
 * Where a run sits in RUN_STAGES. A failed run reports the stage it died in,
 * which the engine records by leaving `runs.status` untouched until the next
 * stage begins — so `failed` itself carries no position and returns -1.
 */
export function runStageIndex(status: RunStatus): number {
  return RUN_STAGES.indexOf(status as RunStage);
}

/**
 * Which stage produces each headline number. A stat is not "0" until the stage
 * that computes it has finished — before that it is unknown, and the run screen
 * shows an em dash. "0 matches" and "matching has not run yet" are different
 * facts and a polled screen has to be able to say both.
 */
export const STAT_PRODUCED_BY: Record<keyof RunStats, RunStage> = {
  entitiesA: "extracting",
  entitiesB: "extracting",
  candidatePairs: "matching",
  matches: "matching",
  conflicts: "detecting",
  autoResolved: "resolving",
  escalated: "resolving",
  tokensUsed: "resolving",
};

/** True once the producing stage is behind us, so the number means something. */
export function isStatKnown(stat: keyof RunStats, status: RunStatus): boolean {
  if (status === "complete") return true;
  // A failed run keeps whatever it computed before it died, and the engine has
  // no way to say which of those numbers it got to. Show them all rather than
  // blank a count that was genuinely measured.
  if (status === "failed") return true;
  return runStageIndex(status) > runStageIndex(STAT_PRODUCED_BY[stat]);
}

/**
 * Which stage a failed run died in. `runs.status` is `failed`, which carries no
 * position, so the stage is read out of the error — the engine's convention is
 * a trailing `stage=<name>` (wireframe 1h: `source=Databricks GTM stage=extract`).
 * Returns null when the error does not say, and the caller then shows no
 * highlighted stage rather than guessing at one.
 */
export function failedStage(error: string | null): RunStage | null {
  const stage = error?.match(/\bstage=([a-z_]+)/i)?.[1]?.toLowerCase();
  if (!stage) return null;

  const byVerb: Record<string, RunStage> = {
    dispatch: "queued",
    queue: "queued",
    extract: "extracting",
    extracting: "extracting",
    match: "matching",
    matching: "matching",
    detect: "detecting",
    detecting: "detecting",
    resolve: "resolving",
    resolving: "resolving",
  };
  return byVerb[stage] ?? null;
}

export const EMPTY_RUN_STATS: RunStats = {
  entitiesA: 0,
  entitiesB: 0,
  candidatePairs: 0,
  matches: 0,
  conflicts: 0,
  autoResolved: 0,
  escalated: 0,
  tokensUsed: 0,
};

/**
 * A READ-ONLY mirror of the auto-apply gate for display (wireframe 1e). The
 * gate itself lives in engine/agent/graph.py as
 * AUTO_APPLY_CONFIDENCE_THRESHOLD / AUTO_APPLY_MAX_SEVERITY, because the
 * evaluation sweeps both. The console shows the operator what a run will do; it
 * must never be able to change it, or two runs at the same threshold would no
 * longer mean the same thing.
 */
export const AUTO_APPLY_GATE = {
  confidenceThreshold: 0.85,
  maxSeverity: 2,
} as const;
