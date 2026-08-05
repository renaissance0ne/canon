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
export type EngineRunStatus = z.infer<typeof engineRunStatusSchema>;
