import { z } from "zod";

/** Tool contract — mirrors engine/pipeline/schema.py. */
export const conflictClassSchema = z.enum([
  "structural",
  "attribute",
  "cosmetic",
  "orphan",
  "duplicate",
]);

/**
 * Severity is a defined integer the auto-apply threshold reads, not a hue and
 * not a vibe (AGENTS.md § Severity Model).
 *
 *   4 structural — changes the shape of the hierarchy; rollups will be wrong
 *   3 attribute  — changes who owns or is credited for something
 *   2 attribute  — changes a non-rollup field
 *   1 cosmetic   — same value, different representation
 */
export const severitySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const matchMethodSchema = z.enum(["exact_key", "embedding", "fuzzy", "agent"]);

export const matchSignalsSchema = z.object({
  exactKey: z.boolean(),
  cosine: z.number(),
  fuzzyRatio: z.number(),
});

export const conflictSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  matchId: z.string().uuid(),
  field: z.string(),
  valueA: z.string(),
  valueB: z.string(),
  conflictClass: conflictClassSchema,
  severity: severitySchema,
  detectedBy: z.enum(["rule", "agent"]),
});

export type ConflictClass = z.infer<typeof conflictClassSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type MatchMethod = z.infer<typeof matchMethodSchema>;
export type MatchSignals = z.infer<typeof matchSignalsSchema>;
export type Conflict = z.infer<typeof conflictSchema>;

/** Never rendered without its word — the mark alone is never the only signal. */
export const SEVERITY_LABEL: Record<Severity, string> = {
  4: "Structural",
  3: "Attribute",
  2: "Attribute",
  1: "Cosmetic",
};
