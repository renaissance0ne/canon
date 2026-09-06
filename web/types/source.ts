import { z } from "zod";
import { datasetNameSchema } from "@/types/dataset";

/** Mirrors engine/pipeline/schema.py. Change both in the same commit. */
export const sourceKindSchema = z.enum([
  "salesforce",
  "hubspot",
  "databricks",
  "snowflake",
  "synthetic",
]);

/**
 * Non-secret shape only — object names, table names, filters. Credentials live
 * in `source_credentials`, encrypted, and never in this column.
 *
 * `dataset` is the one field here that reaches a filesystem, and it is a NAME,
 * not a path: the engine joins it under its own dataset root and rejects
 * anything with a separator in it (engine/dataset_store.py). It applies to
 * synthetic sources only; a source that names none falls back to the engine's
 * CANON_SYNTHETIC_DATA_DIR, which is what every source created before datasets
 * were selectable does.
 */
export const sourceConfigSchema = z.object({
  objects: z.array(z.string()).min(1),
  filter: z.string().optional(),
  dataset: datasetNameSchema.optional(),
});

export const createSourceSchema = z.object({
  name: z.string().min(1).max(80),
  kind: sourceKindSchema,
  config: sourceConfigSchema,
});

export const sourceSchema = createSourceSchema.extend({
  id: z.string().uuid(),
  createdAt: z.coerce.date(),
});

/** A parsed Zod schema is the type — no hand-maintained duplicate. */
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export type CreateSource = z.infer<typeof createSourceSchema>;
export type Source = z.infer<typeof sourceSchema>;

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  salesforce: "Salesforce",
  hubspot: "HubSpot",
  databricks: "Databricks",
  snowflake: "Snowflake",
  synthetic: "Synthetic",
};

/** Which half of the reconciliation a kind can serve. */
export const SOURCE_KIND_SIDE: Record<SourceKind, "crm" | "warehouse" | "either"> = {
  salesforce: "crm",
  hubspot: "crm",
  databricks: "warehouse",
  snowflake: "warehouse",
  synthetic: "either",
};

/**
 * Whether a kind needs stored credentials before a run can read it.
 *
 * `synthetic` is the one that does not: it is generated locally from a seed and
 * there is nothing to authenticate against. That is what makes it the source
 * kind you can demonstrate the whole pipeline with, and why the run form treats
 * it as always-connected.
 *
 * Mirrors `requiresCredentials` in engine/pipeline/credentials.py, which derives
 * the same fact from each platform's default auth method.
 */
export function requiresCredentialsForKind(kind: SourceKind): boolean {
  return kind !== "synthetic";
}
