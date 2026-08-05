import { z } from "zod";

/** Mirrors engine/pipeline/schema.py. Change both in the same commit. */
export const sourceKindSchema = z.enum([
  "salesforce",
  "hubspot",
  "databricks",
  "snowflake",
  "synthetic",
]);

/** Non-secret shape only. Credentials live in the engine env, keyed by kind. */
export const sourceConfigSchema = z.object({
  objects: z.array(z.string()).min(1),
  filter: z.string().optional(),
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
