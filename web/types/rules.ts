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
 * A stored ruleset. `version` is assigned server-side — a client cannot pick
 * one, because a version number that two rulesets could share would make
 * "which policy did this run use?" unanswerable.
 */
export const rulesetSchema = createRulesetSchema.extend({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  /** Exactly one ruleset is active. It is what a new run defaults to. */
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
});

export type Ruleset = z.infer<typeof rulesetSchema>;

/** The wildcard, spelled once. `"*"` in both `field` and `entityType`. */
export const RULE_WILDCARD = "*";

export const RULE_STRATEGY_LABEL: Record<RuleStrategy, string> = {
  prefer_source: "prefer_source",
  most_recent: "most_recent",
  most_complete: "most_complete",
  escalate: "escalate",
};

/** Shown under the strategy in the editor, so the policy reads as English. */
export const RULE_STRATEGY_HINT: Record<RuleStrategy, string> = {
  prefer_source: "one system is authoritative for this field",
  most_recent: "newest lastModifiedAt wins",
  most_complete: "non-null, longer value wins",
  escalate: "never auto-resolved — always reaches a human",
};

/**
 * Author order after a stable sort by specificity. This is the order the engine
 * evaluates in (engine/pipeline/schema.py::rule_specificity), so the editor
 * shows the policy the way it will actually run rather than the way it was
 * typed — a rule that can never fire should be visible as the last row, not
 * discovered in a run three days later.
 */
export function orderRulesByEvaluation(rules: SurvivorshipRule[]): SurvivorshipRule[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => ruleSpecificity(b.rule) - ruleSpecificity(a.rule) || a.index - b.index)
    .map(({ rule }) => rule);
}

/**
 * Most specific first: exact field + exact entityType beats a wildcard on
 * either. Ties keep author order, so the first match wins deterministically.
 */
export function ruleSpecificity(rule: SurvivorshipRule): number {
  return (rule.field === "*" ? 0 : 2) + (rule.entityType === "*" ? 0 : 1);
}
