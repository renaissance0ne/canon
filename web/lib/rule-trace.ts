import { formatConfidence } from "@/lib/format";
import type { QueueRow } from "@/types/queue";

/**
 * The rule trace in wireframe 1j: how this conflict reached the answer it did.
 *
 * ```
 * classify → parentExternalId/account → escalate
 * propose · skipped   validate · skipped
 * ```
 *
 * Every step is DERIVED from what was recorded, never guessed. The graph itself
 * lives in engine/agent/graph.py and does not report its path; what the
 * resolution row carries is enough to reconstruct it:
 *
 *   appliedRuleId set    a rule decided, so `propose` never ran
 *   appliedRuleId null   the ruleset did not decide it and the model proposed
 *   proposedValue empty  nothing was proposed, so `validate` had nothing to check
 *
 * That is the whole point of the deterministic-first design being worth
 * building: a reviewer can see which decisions needed a model and which did not.
 */

export type TraceStep = {
  /** A node in the graph. Named exactly as in engine/agent/graph.py. */
  node: "classify" | "apply" | "propose" | "validate";
  /** What the node did, or what it decided. Null when it did not run. */
  detail: string | null;
  ran: boolean;
};

export function deriveRuleTrace(row: QueueRow): TraceStep[] {
  const { resolution } = row;
  const selector = `${row.field}/${row.entityType}`;

  // Nothing has been through the graph yet — the resolve stage has not reached
  // this conflict. Say that, rather than drawing a trace of skipped nodes that
  // implies a decision was made.
  if (!resolution) {
    return [
      { node: "classify", detail: `${selector} → not yet resolved`, ran: false },
    ];
  }

  const ruleDecided = resolution.appliedRuleId !== null;
  const strategy = resolution.appliedRuleStrategy ?? resolution.appliedRuleId;
  const hasValue = resolution.proposedValue.length > 0;

  return [
    {
      node: "classify",
      detail: ruleDecided
        ? `${selector} → ${strategy}`
        : `${selector} → no rule matched`,
      ran: true,
    },
    {
      node: "apply",
      detail: ruleDecided && hasValue ? resolution.proposedValue : null,
      ran: ruleDecided && hasValue,
    },
    {
      node: "propose",
      detail: !ruleDecided && hasValue
        ? `${resolution.proposedValue} · ${formatConfidence(resolution.confidence)}`
        : null,
      ran: !ruleDecided && hasValue,
    },
    {
      // Deterministic and non-optional: it passed, or no value ever reached it.
      // It cannot have failed and still be on a resolution row with a value —
      // a failed validate escalates without one.
      node: "validate",
      detail: hasValue ? "observed value · passed" : null,
      ran: hasValue,
    },
  ];
}
