import { z } from "zod";

/**
 * Tool contract — mirrors engine/pipeline/schema.py::SurvivorshipRule.
 *
 * Rules are evaluated most specific first: exact `field` + exact `entityType`
 * beats a wildcard on either. First match wins. If no rule matches, the
 * conflict escalates — Canon never guesses in the absence of policy.
 */
export const ruleStrategySchema = z.enum([
  /** One system is authoritative for this field. */
  "prefer_source",
  /** Newest lastModifiedAt wins. */
  "most_recent",
  /** Non-null / longer value wins. */
  "most_complete",
  /** Never auto-resolve this field. */
  "escalate",
]);

export const survivorshipRuleSchema = z
  .object({
    id: z.string(),
    /** "*" = applies to any field. */
    field: z.string(),
    entityType: z.string(),
    strategy: ruleStrategySchema,
    preferredSourceId: z.string().optional(),
    /** Plain English — goes into the agent prompt. */
    description: z.string(),
  })
  .refine(
    (rule) => rule.strategy !== "prefer_source" || Boolean(rule.preferredSourceId),
    { message: "preferredSourceId is required when strategy is prefer_source", path: ["preferredSourceId"] },
  );

export type RuleStrategy = z.infer<typeof ruleStrategySchema>;
export type SurvivorshipRule = z.infer<typeof survivorshipRuleSchema>;

/** Rulesets are versioned, never edited in place — a past run must still reproduce. */
export const createRulesetSchema = z.object({
  name: z.string().min(1).max(80),
  rules: z.array(survivorshipRuleSchema).min(1),
});

export type CreateRuleset = z.infer<typeof createRulesetSchema>;

/**
 * Most specific first: exact field + exact entityType beats a wildcard on
 * either. Ties keep author order, so the first match wins deterministically.
 */
export function ruleSpecificity(rule: SurvivorshipRule): number {
  return (rule.field === "*" ? 0 : 2) + (rule.entityType === "*" ? 0 : 1);
}
