import { z } from "zod";

/**
 * Tool contract — mirrors engine/pipeline/schema.py::CanonicalEntity.
 * Do not change one side without changing the other in the same commit.
 */
export const entityTypeSchema = z.enum(["account", "user", "role", "territory"]);

export const canonicalEntitySchema = z.object({
  externalId: z.string(),
  entityType: entityTypeSchema,
  name: z.string(),
  /** Folded; what matching actually compares. Folding is recorded, not destructive. */
  normalizedName: z.string(),
  /** The hierarchy edge. */
  parentExternalId: z.string().nullable(),
  attributes: z.record(z.string(), z.string().nullable()),
  /** ISO 8601 — drives recency survivorship. */
  lastModifiedAt: z.string().nullable(),
  sourceId: z.string(),
});

export type EntityType = z.infer<typeof entityTypeSchema>;
export type CanonicalEntity = z.infer<typeof canonicalEntitySchema>;
