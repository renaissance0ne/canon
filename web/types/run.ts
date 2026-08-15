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

/**
 * Which model family the `propose` node calls. Mirrors
 * engine/pipeline/schema.py::ModelProvider.
 *
 * Recorded on the run row for the same reason `rulesetId` is: two runs that
 * disagree are only comparable if what produced each answer is on the record.
 * A run never falls back to the other provider — one that asked for Gemini and
 * silently got Claude would put a false statement on the row.
 */
export const modelProviderSchema = z.enum(["claude", "gemini"]);

export const MODEL_PROVIDER_LABEL: Record<ModelProvider, string> = {
  claude: "Claude",
  gemini: "Gemini",
};

/**
 * The order the console offers them in. Not derived from the enum, so adding a
 * provider is a deliberate decision about where it appears rather than a
 * side effect of alphabetical order.
 */
export const MODEL_PROVIDERS = ["claude", "gemini"] as const satisfies readonly ModelProvider[];

export const runStatsSchema = z.object({
  entitiesA: z.number().int().nonnegative(),
  entitiesB: z.number().int().nonnegative(),
  candidatePairs: z.number().int().nonnegative(),
  matches: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  autoResolved: z.number().int().nonnegative(),
  escalated: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),

  /**
   * Agent health. A failed model call escalates — correct behaviour, but it
   * means `escalated` mixes two different facts: conflicts the agent judged
   * genuinely ambiguous, and conflicts nobody ever got an answer for.
   *
   * Defaulted, because runs written before these existed have no value for
   * them and a missing count must not fail the parse. Zero is also the honest
   * reading of an old row: nothing is known to have failed.
   */
  modelCalls: z.number().int().nonnegative().default(0),
  /** Escalations that are NOT a statement about the conflict. */
  modelErrors: z.number().int().nonnegative().default(0),
  /** Throttled and retried. Cost wall-clock, not correctness. */
  modelRateLimited: z.number().int().nonnegative().default(0),
});

export const createRunSchema = z.object({
  /** The CRM side. */
  sourceAId: z.string().uuid(),
  /** The warehouse side. */
  sourceBId: z.string().uuid(),
  rulesetId: z.string().uuid(),
  /**
   * Which model resolves the conflicts the ruleset does not decide. Defaulted
   * rather than required so an existing caller keeps working and lands on the
   * same provider every past run used — a default that changed the model would
   * change results without changing a request.
   */
  modelProvider: modelProviderSchema.default("claude"),
});

export const runSchema = createRunSchema.extend({
  id: z.string().uuid(),
  // Not optional on the way out. The column is NOT NULL with a default, so a
  // row always has one, and a reader must never have to guess which model
  // produced the numbers next to it.
  modelProvider: modelProviderSchema,
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

/**
 * GET {ENGINE_URL}/providers — which model families the engine can call.
 *
 * `configured` is the PRESENCE of a key, never a key, not even masked. All
 * model calls happen inside the engine; the console learns only whether one is
 * possible, which is what lets the run form default to a provider that works
 * and say plainly why the other does not.
 */
export const engineProviderSchema = z.object({
  provider: modelProviderSchema,
  /** The resolution model this engine would actually use. */
  model: z.string(),
  configured: z.boolean(),
});

export const engineProvidersSchema = z.object({
  providers: z.array(engineProviderSchema),
});

export type ModelProvider = z.infer<typeof modelProviderSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunStats = z.infer<typeof runStatsSchema>;
export type CreateRun = z.infer<typeof createRunSchema>;
export type Run = z.infer<typeof runSchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
export type EngineRunStatus = z.infer<typeof engineRunStatusSchema>;
export type EngineProvider = z.infer<typeof engineProviderSchema>;

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
  modelCalls: "resolving",
  modelErrors: "resolving",
  modelRateLimited: "resolving",
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
  modelCalls: 0,
  modelErrors: 0,
  modelRateLimited: 0,
};

/**
 * A run completed, but some of its escalations are missing answers rather than
 * carrying judgements. `escalated` cannot be read as "conflicts needing human
 * judgement" while this is true, which is the whole reason the counts exist.
 */
export function isRunDegraded(stats: RunStats): boolean {
  return stats.modelErrors > 0;
}

/**
 * Escalations that ARE the agent's judgement — the rest were never answered.
 * A floor at zero: the two numbers come from different counters and a
 * pathological run must not render a negative queue size.
 */
export function trustworthyEscalations(stats: RunStats): number {
  return Math.max(0, stats.escalated - stats.modelErrors);
}

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
