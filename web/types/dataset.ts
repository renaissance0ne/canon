import { z } from "zod";

/**
 * Synthetic datasets — mirrors engine/pipeline/schema.py. Change both in the
 * same commit.
 *
 * A dataset is generated ON THE ENGINE, from a seed, and never travels through
 * this layer: the console sends parameters and receives a summary. What it
 * names is a directory on the engine's disk, which is why `name` is a name and
 * not a path — the engine joins it under its own root and rejects anything
 * else. See engine/dataset_store.py.
 */

/**
 * The divergence rates, as a fraction of all generated records. Defaults are
 * AGENTS.md § Synthetic Data & Ground Truth, and every one of them has a
 * detector on the other side — a rate with nothing to detect it would be a
 * dataset feature that scores nothing.
 */
const injectionRatesObject = z.object({
  reparent: z.number().min(0).max(1),
  staleAttribute: z.number().min(0).max(1),
  nameVariant: z.number().min(0).max(1),
  missingRecord: z.number().min(0).max(1),
  duplicateRecord: z.number().min(0).max(1),
  ambiguous: z.number().min(0).max(1),
});

export const injectionRatesSchema = injectionRatesObject.refine(
  (rates) => Object.values(rates).reduce((sum, rate) => sum + rate, 0) <= 1,
  // One record carries at most one divergence: the generator draws every
  // injection from a single shared pool, so quotas that sum past the
  // population cannot all be filled and the manifest would quietly not match
  // the parameters that produced it.
  { message: "Rates sum to more than 100% of records. One record carries one divergence." },
);

export const DEFAULT_INJECTION_RATES: InjectionRates = {
  reparent: 0.05,
  staleAttribute: 0.08,
  nameVariant: 0.12,
  missingRecord: 0.03,
  duplicateRecord: 0.02,
  ambiguous: 0.02,
};

/**
 * What each rate injects and what it tests. Shown next to the field, because
 * a reviewer choosing 12% needs to know what they are choosing 12% of.
 */
export const INJECTION_META: Record<
  keyof InjectionRates,
  { label: string; tests: string }
> = {
  reparent: { label: "Re-parent one side", tests: "structural detection" },
  staleAttribute: { label: "Stale territory / role", tests: "attribute detection · recency rules" },
  nameVariant: { label: "Name variant", tests: "normalization · cosmetic classification" },
  missingRecord: { label: "Missing record", tests: "orphan detection" },
  duplicateRecord: { label: "Duplicate record", tests: "duplicate detection" },
  ambiguous: { label: "Genuinely ambiguous", tests: "escalation behaviour" },
};

/**
 * A directory name on the engine, not a path. Mirrors NAME_PATTERN in
 * engine/dataset_store.py — this is the only string the console contributes to
 * a filesystem operation anywhere in the engine, so it is checked on both
 * sides and the engine's check is the one that counts.
 */
export const datasetNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
    "Letters, digits, dot, dash or underscore. It names a directory on the engine.",
  );

export const generateDatasetSchema = z.object({
  name: datasetNameSchema,
  /** Same seed, same bytes. Commit the seed used for reported results. */
  seed: z.number().int().min(0).max(2147483647),
  /** Bounded because generation is synchronous and the console waits on it. */
  accounts: z.number().int().min(1).max(20000),
  rates: injectionRatesSchema,
  /** Overwrite a name that is taken. Never the default — see the 409 path. */
  force: z.boolean().optional(),
});

/** GET {ENGINE_URL}/datasets — one entry per dataset on the engine's disk. */
export const datasetSummarySchema = z.object({
  name: z.string(),
  generatorVersion: z.number().int(),
  seed: z.number().int(),
  accounts: z.number().int(),
  rates: injectionRatesObject,
  entitiesA: z.number().int(),
  entitiesB: z.number().int(),
  /** Ground truth: how many divergences were injected, and of what kind. */
  divergences: z.number().int(),
  byClass: z.record(z.string(), z.number().int()),
  /**
   * Of those, how many the manifest expects to be ESCALATED rather than
   * resolved. A dataset with none of these cannot score escalation at all,
   * which is why the console shows the number rather than burying it.
   */
  escalations: z.number().int(),
});

export const engineDatasetsSchema = z.object({
  datasets: z.array(datasetSummarySchema),
  /** What a synthetic source with no `dataset` in its config actually reads. */
  fallback: z.string().nullable().default(null),
});

export type InjectionRates = z.infer<typeof injectionRatesObject>;
export type GenerateDataset = z.infer<typeof generateDatasetSchema>;
export type DatasetSummary = z.infer<typeof datasetSummarySchema>;
export type EngineDatasets = z.infer<typeof engineDatasetsSchema>;

/**
 * The manifest's sentinel `field` for a divergence in a record's EXISTENCE
 * rather than one of its columns — orphans and duplicates. Mirrors
 * RECORD_FIELD in engine/eval/generate.py.
 */
export const RECORD_FIELD = "__record__";

/**
 * `expectedResolution` when no value is correct and the only right answer is to
 * hand the decision to a human. Mirrors ESCALATE in engine/eval/generate.py.
 *
 * These are the rows that matter most in the manifest: a generator that only
 * produced resolvable conflicts would score a system that guesses exactly as
 * well as one that escalates correctly.
 */
export const ESCALATE = "escalate";

/** One injected divergence — mirrors engine/pipeline/schema.py. */
export const manifestDivergenceSchema = z.object({
  /** Always the real-world entity, never the artifact of the injection. */
  entityId: z.string(),
  field: z.string(),
  /** What the canonical org actually says. Null where no value is right. */
  trueValue: z.string().nullable().default(null),
  sideAValue: z.string().nullable().default(null),
  sideBValue: z.string().nullable().default(null),
  conflictClass: z.enum(["structural", "attribute", "cosmetic", "orphan", "duplicate"]),
  expectedResolution: z.string(),
});

/** GET {ENGINE_URL}/datasets/:name — the dataset plus a page of its manifest. */
export const datasetDetailSchema = z.object({
  dataset: datasetSummarySchema,
  divergences: z.array(manifestDivergenceSchema),
  /** After filtering — what the pager is actually walking. */
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export type ManifestDivergence = z.infer<typeof manifestDivergenceSchema>;
export type DatasetDetail = z.infer<typeof datasetDetailSchema>;
export type ConflictClassFilter = ManifestDivergence["conflictClass"];

/** How the manifest reads a divergence, for a reader who is not the generator. */
export function divergenceFieldLabel(divergence: ManifestDivergence): string {
  if (divergence.field !== RECORD_FIELD) return divergence.field;
  return divergence.conflictClass === "duplicate" ? "duplicate record" : "record exists";
}
