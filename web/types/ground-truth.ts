import { z } from "zod";
import { ESCALATE, type ManifestDivergence } from "@/types/dataset";
import type { ResolutionStatus } from "@/types/resolution";

/**
 * Scoring a run against the dataset it ran on.
 *
 * This is only ever possible for a SYNTHETIC source, and that is the whole
 * point of synthetic data: the manifest says what the right answer was, so the
 * console can show — per conflict, not just in aggregate — whether the agent
 * got it. AGENTS.md § Evaluation Harness owns the reported numbers; this is the
 * same comparison made legible one row at a time.
 *
 * The verdict vocabulary mirrors `score_run` in engine/eval/harness.py. Where
 * it differs, it differs because the console sees a row the harness never does:
 * a resolution a human has since reviewed.
 */

/** What the agent did about one injected divergence. */
export const verdictSchema = z.enum([
  /** Applied, and the value matched the manifest. */
  "correct",
  /** Applied, and it did not — the metric that matters most operationally. */
  "false_auto_apply",
  /** Escalated something the manifest says is genuinely ambiguous. A success. */
  "correct_escalation",
  /** Escalated something the manifest had a definite answer for. A cost. */
  "over_escalation",
  /** Detected, and no resolution was written. */
  "unresolved",
  /** A human threw the proposal out. Not the agent's verdict to claim either way. */
  "rejected",
  /** In the manifest, and the run never detected it. A false negative. */
  "missed",
]);

export type Verdict = z.infer<typeof verdictSchema>;

/** Reads as a word, never as a color — there is no color in this console. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  correct: "Correct",
  false_auto_apply: "Wrong value applied",
  correct_escalation: "Correctly escalated",
  over_escalation: "Escalated a decidable case",
  unresolved: "Not resolved",
  rejected: "Rejected by reviewer",
  missed: "Not detected",
};

/**
 * The mark. Shape, not fill — the same grammar resolution status uses.
 * `✓` the agent was right, `✕` it was wrong, `■` it handed the case over,
 * `○` nothing happened to it.
 */
export const VERDICT_MARK: Record<Verdict, string> = {
  correct: "✓",
  false_auto_apply: "✕",
  correct_escalation: "■",
  over_escalation: "□",
  unresolved: "○",
  rejected: "/",
  missed: "—",
};

/** Whether a verdict is one the system should want. Used for the scorecard split. */
export function isGoodVerdict(verdict: Verdict): boolean {
  return verdict === "correct" || verdict === "correct_escalation";
}

/**
 * A resolution's status, reduced to the two dispositions the manifest can be
 * scored against.
 *
 * The harness only ever sees `auto_applied` and `escalated`, because it scores
 * the engine's own output. The console sees rows a human has since acted on,
 * and `resolutions.status` is updated in place by that review — so the engine's
 * original disposition is not recoverable from the row.
 *
 * `approved` and `overridden` are therefore read as applied: in both, a value
 * stands. `rejected` is neither — it is reported as its own verdict rather than
 * folded into one of the two, because counting a human's rejection as an agent
 * error would attribute a decision to the wrong party.
 */
export function disposition(
  status: ResolutionStatus,
): "applied" | "escalated" | "rejected" {
  switch (status) {
    case "auto_applied":
    case "approved":
    case "overridden":
      return "applied";
    case "rejected":
      return "rejected";
    case "escalated":
    case "proposed":
      return "escalated";
  }
}

/**
 * The verdict for one manifest entry, given what the run did about it.
 *
 * `proposedValue` is the AGENT's answer, always — not `overrideValue`. A human
 * correcting a proposal does not make the proposal right, and this function
 * exists to say what the agent did.
 */
export function verdictFor(
  divergence: ManifestDivergence,
  outcome: { status: ResolutionStatus; proposedValue: string } | null,
  detected: boolean,
): Verdict {
  if (!detected) return "missed";
  if (outcome === null) return "unresolved";

  const disposed = disposition(outcome.status);
  if (disposed === "rejected") return "rejected";

  const ambiguous = divergence.expectedResolution === ESCALATE;

  if (disposed === "escalated") {
    return ambiguous ? "correct_escalation" : "over_escalation";
  }

  // Applied. Nothing is a correct value for a case the manifest says has none,
  // so an applied resolution on an ambiguous entry is wrong by construction.
  if (ambiguous) return "false_auto_apply";

  return outcome.proposedValue === divergence.expectedResolution
    ? "correct"
    : "false_auto_apply";
}

/** One manifest entry, and what the selected run did about it. */
export type ScoredDivergence = {
  divergence: ManifestDivergence;
  verdict: Verdict;
  /** The agent's answer. Null when nothing was detected or nothing resolved. */
  proposedValue: string | null;
  rationale: string | null;
  appliedRuleId: string | null;
  confidence: number | null;
  status: ResolutionStatus | null;
  /** What a reviewer chose instead, when they overrode the proposal. */
  overrideValue: string | null;
  /** The conflict this run raised for it, for a link into the queue. */
  conflictId: string | null;
};

/**
 * A run measured against the manifest.
 *
 * Detection and resolution are counted separately because they fail
 * differently: a divergence the run never saw is a detector problem, and a
 * divergence it saw and answered wrong is an agent problem. Reporting one
 * number over both would hide which.
 */
export type RunScorecard = {
  runId: string;
  /** Injected divergences in the manifest — the denominator for recall. */
  expected: number;
  /** Of those, how many this run raised a conflict for. */
  detected: number;
  /** Conflicts this run raised that the manifest has no entry for. */
  notInTruth: number;
  byVerdict: Record<Verdict, number>;
};

export const EMPTY_VERDICT_COUNTS: Record<Verdict, number> = {
  correct: 0,
  false_auto_apply: 0,
  correct_escalation: 0,
  over_escalation: 0,
  unresolved: 0,
  rejected: 0,
  missed: 0,
};
