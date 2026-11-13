import type { ConflictClass, Severity } from "@/types/conflict";
import type { InjectionRates } from "@/types/dataset";
import type { Verdict } from "@/types/ground-truth";
import type { AuditAction, ResolutionStatus } from "@/types/resolution";
import type { RuleStrategy } from "@/types/rules";
import { AUTO_APPLY_GATE, type RunStage, type RunStats } from "@/types/run";

/**
 * Every explanation the console gives, in one place.
 *
 * Tooltips and the docs page both read from here, so the sentence a reviewer
 * sees on hover is the same sentence the guide uses — two hand-written copies
 * would drift the first time a threshold moved. Numbers that live in the
 * engine are interpolated from their read-only mirrors in types/, never typed
 * into a string.
 *
 * Plain text only: a tooltip is announced as an accessible description, and
 * markup inside one is read as noise.
 */

const GATE = `confidence ≥ ${AUTO_APPLY_GATE.confidenceThreshold.toFixed(2)} and severity ≤ ${AUTO_APPLY_GATE.maxSeverity}`;

/**
 * The name-only match bar, mirrored for display. Lives in
 * engine/pipeline/blocking.py as MIN_NAME_MATCH_CONFIDENCE.
 */
export const NAME_MATCH_CONFIDENCE = 0.92;

/** The headline numbers on a run. Keyed like `RunStats`, so none can be missed. */
export const STAT_HELP: Record<keyof RunStats, string> = {
  entitiesA:
    "Records read from source A (the CRM side) after normalization, across accounts, users, roles and territories.",
  entitiesB:
    "Records read from source B (the warehouse side) after normalization, across accounts, users, roles and territories.",
  candidatePairs:
    "Pairs worth comparing, found by blocking: same external id, then same normalized name, then nearest neighbours by name. Blocking keeps this close to the number of records rather than its square.",
  matches: `Candidate pairs accepted as the same real-world entity. A shared external id always matches; otherwise name similarity and field agreement together must reach ${NAME_MATCH_CONFIDENCE}.`,
  conflicts:
    "Disagreements found inside matches — one per differing field — plus orphans (present on one side only) and duplicates (two records on one side for one on the other).",
  autoResolved: `Conflicts Canon resolved without a person: a rule or the model chose one of the two observed values, and it cleared the gate (${GATE}).`,
  escalated:
    "Conflicts handed to a reviewer — every severity 3 and 4, anything no rule decides and the model would not settle, and anything a rule marks escalate. Escalation is a correct outcome, not a failure.",
  tokensUsed:
    "Model tokens this run spent, including cached reads of the ruleset prompt. Zero when the rules decided everything or no model key is configured.",
  modelCalls: "Model requests that returned an answer.",
  modelErrors:
    "Conflicts sent to the model that came back without an answer and escalated instead. These escalations are not the agent's judgement.",
  modelRateLimited:
    "Requests the provider throttled and Canon retried. Costs wall-clock time, not correctness.",
};

/** The run pipeline, stage by stage. */
export const STAGE_HELP: Record<RunStage, string> = {
  queued: "The run row exists and has been handed to the engine, which has not started yet.",
  extracting:
    "Reading both sources and normalizing every record into the canonical shape. Both sides are read at once.",
  matching:
    "Pairing records that describe the same entity: exact id, exact normalized name, then embedding nearest neighbours scored on name and field agreement.",
  detecting:
    "Diffing every match field by field, classifying each disagreement and scoring its severity. Unmatched records become orphans.",
  resolving:
    "Applying the ruleset to each conflict, asking the model only where no rule decides, validating every proposed value, then auto-applying or escalating.",
  complete: "Finished. Escalated conflicts are waiting in the review queue.",
};

/** Severity levels. The gate reads these integers; they are not a mood. */
export const SEVERITY_HELP: Record<Severity, string> = {
  4: "Structural — changes the shape of the hierarchy, so rollups will be wrong. A different parent, an orphan with children, or a duplicate. Never auto-applied.",
  3: "Attribute, ownership — changes who owns or is credited for something: territory, role or owner. Never auto-applied.",
  2: "Attribute, non-rollup — changes a field that no rollup reads, such as industry or segment. Auto-applied when confidence clears the gate.",
  1: "Cosmetic — the same value written differently, like “Acme Inc.” against “ACME INC”. Auto-applied when confidence clears the gate.",
};

export const CONFLICT_CLASS_HELP: Record<ConflictClass, string> = {
  structural: "The two systems disagree on a hierarchy edge — usually the parent.",
  attribute: "The two systems hold different values for the same field.",
  cosmetic: "The values fold to the same normalized form: case, spacing, punctuation or a legal suffix.",
  orphan: "The entity exists in one system and not the other.",
  duplicate: "One system holds two records for an entity the other holds once, so totals double-count.",
};

export const RESOLUTION_STATUS_HELP: Record<ResolutionStatus, string> = {
  proposed: "A value has been proposed and not yet routed.",
  auto_applied: `Decided without a person: the value passed validation and cleared the gate (${GATE}). Shown so a wrong one can be corrected.`,
  escalated: "Canon declined to decide. A reviewer must approve, override or reject it.",
  approved: "A reviewer accepted the proposed value.",
  rejected: "A reviewer threw the proposal out without choosing a value.",
  overridden: "A reviewer chose a value of their own — including picking one side when no value was proposed.",
};

/** Survivorship strategies, as the rule editor and the docs explain them. */
export const STRATEGY_HELP: Record<RuleStrategy, string> = {
  prefer_source:
    "One system is authoritative for this field: its value always wins. Requires a preferred source.",
  most_recent:
    "The side with the newer last-modified time wins. Declines when the timestamps are equal or missing, which sends the conflict on to the model or a reviewer.",
  most_complete:
    "A value beats an empty one, and a longer value beats a shorter one. Declines when both are the same length.",
  escalate: "Never auto-resolved. Every conflict this rule matches goes straight to a reviewer, without asking the model.",
};

/** What each dataset injection rate adds, and what it lets the evaluation measure. */
export const INJECTION_HELP: Record<keyof InjectionRates, string> = {
  reparent:
    "Moves an entity under a different parent on one side, with that side holding the older edit. Tests structural detection and most_recent.",
  staleAttribute:
    "Leaves one side holding an old territory, owner, role, segment, industry or region. Tests attribute detection and recency rules.",
  nameVariant:
    "Respells a name on one side — case, punctuation, spacing, legal suffix. Tests normalization and cosmetic classification.",
  missingRecord: "Deletes a record from one side. Tests orphan detection.",
  duplicateRecord:
    "Adds a second, respelled copy of a record to one side under a new id. Tests duplicate detection.",
  ambiguous:
    "Both sides edit the same ownership field on the same day to different values, so no rule can decide. The correct answer is to escalate — keep this above zero or escalation cannot be scored.",
};

/** Run scorecard verdicts against a dataset's ground truth. */
export const VERDICT_HELP: Record<Verdict, string> = {
  correct: "Applied, and the value matched the ground truth.",
  false_auto_apply:
    "Applied, and the value was wrong. The metric that matters most operationally: nothing else catches it.",
  correct_escalation: "Escalated a case the ground truth marks as genuinely ambiguous. A success.",
  over_escalation: "Escalated a case that had a definite answer. A cost to the reviewer, not an error.",
  unresolved: "Detected, but no resolution was written.",
  rejected: "A reviewer rejected the proposal, so it counts neither for nor against the agent.",
  missed: "Injected into the dataset, and the run never raised a conflict for it.",
};

export const AUDIT_ACTION_HELP: Record<AuditAction, string> = {
  run_started: "A run began. Records the sources, ruleset version and model it executed with.",
  conflict_detected: "A conflict was found during detection.",
  resolution_proposed: "A resolution was proposed.",
  auto_applied: "A resolution cleared the gate and was applied without review.",
  escalated: "A resolution was handed to a reviewer.",
  human_approved: "A reviewer approved the proposed value.",
  human_rejected: "A reviewer rejected the proposal.",
  human_overridden: "A reviewer chose their own value.",
  run_degraded: "The run completed, but some model calls failed, so part of its escalations carry no judgement.",
  run_failed: "The run stopped with an error. The message names the stage.",
};

/**
 * Free-standing terms. Each is a tooltip somewhere in the console and an entry
 * in the docs glossary, alphabetised there by `term`.
 */
export const TERM_HELP = {
  sourceA: {
    term: "Source A",
    text: "The CRM side of a reconciliation — where reps and ops edit accounts, roles and territories. Shown in the left column of every diff.",
  },
  sourceB: {
    term: "Source B",
    text: "The warehouse side — where analytics reads the same structure after ETL. Shown in the right column of every diff.",
  },
  ruleset: {
    term: "Ruleset",
    text: "A versioned survivorship policy. Saving creates a new version and never edits an old one, so every past run can still be read back exactly as it executed.",
  },
  modelProvider: {
    term: "Model provider",
    text: "Which model family answers the conflicts no rule decides. Recorded on the run. A run never falls back to the other provider; with no key it resolves what the rules cover and escalates the rest.",
  },
  autoApplyGate: {
    term: "Auto-apply gate",
    text: `A resolution is applied without review only when ${GATE}. Both conditions, always. The thresholds are engine constants the evaluation sweeps, so the console shows them and never edits them.`,
  },
  confidence: {
    term: "Confidence",
    text: "How sure the resolver is that the chosen value is correct, from 0 to 1. A deterministic rule reports 0.95; the model reports its own estimate.",
  },
  validate: {
    term: "Validate",
    text: "A deterministic check on every proposal: the value must be one of the two observed values or a legal normalization of one. Anything else is rejected and escalated — Canon never invents a value.",
  },
  rationale: {
    term: "Rationale",
    text: "Two sentences naming both values, the rule or reasoning applied, and what was chosen. Written to be decided from in five seconds.",
  },
  ruleTrace: {
    term: "Rule trace",
    text: "The rules in the order the engine evaluated them, and which one fired. Most specific first: an exact field and entity type beat a wildcard on either.",
  },
  specificity: {
    term: "Specificity",
    text: "Rules are tried most specific first — exact field and entity type, then exact field, then exact entity type, then the */* catch-all. The first rule that matches wins. No match means escalate.",
  },
  wildcard: {
    term: "Wildcard (*)",
    text: "A rule with * as its field or entity type applies to every field or every entity type. It loses to any rule that names one exactly.",
  },
  preferredSource: {
    term: "Preferred source",
    text: "The system whose value wins under prefer_source. Required for that strategy and ignored by the others.",
  },
  escalation: {
    term: "Escalation",
    text: "Handing a conflict to a reviewer instead of deciding it. Escalating the genuinely ambiguous cases is the system working correctly.",
  },
  matchEvidence: {
    term: "Match evidence",
    text: "Why two records were treated as the same entity: name similarity (fuzzy ratio and embedding cosine), the share of shared fields that agree, and whether the external ids are identical.",
  },
  fieldAgreement: {
    term: "Field agreement",
    text: "Of the fields both records populate — parent, territory, owner, segment and the rest — the share that agree. It is what separates two similarly named accounts from one account spelled two ways.",
  },
  seed: {
    term: "Seed",
    text: "The number a synthetic dataset is generated from. Same seed, same rates, same accounts: the same bytes. Cite it with any reported result.",
  },
  accounts: {
    term: "Accounts",
    text: "How many accounts the synthetic org has. Users, roles and territories scale with it.",
  },
  groundTruth: {
    term: "Ground truth",
    text: "The manifest a synthetic dataset is generated with: every injected divergence, which side holds what, and the correct resolution — or escalate.",
  },
  synthetic: {
    term: "Synthetic source",
    text: "A source that reads a generated dataset from the engine's disk. Needs no credentials. A synthetic run needs two of them: one reads side A, the other side B.",
  },
  degraded: {
    term: "Degraded run",
    text: "A run that completed but whose model calls partly failed. Escalated minus unanswered is the part of the queue that reflects the agent's judgement.",
  },
  writeBack: {
    term: "No write-back",
    text: "Canon proposes and records. It never changes Salesforce, the warehouse or any other source system.",
  },
} as const satisfies Record<string, { term: string; text: string }>;

export type TermKey = keyof typeof TERM_HELP;

/** The three shapes of the review queue. Keyed like `QueueView`. */
export const QUEUE_VIEW_HELP = {
  ledger: "One full diff per row, read top to bottom. Best for a short queue you want to read closely.",
  focus: "A list on the left and one large diff on the right. The list never moves, so j and k only change the pane.",
  dense: "36px rows that expand in place. Keeps a queue of hundreds scannable.",
} as const;

/** Navigation, one line per destination. */
export const NAV_HELP = {
  runs: "Every reconciliation: start one, watch it run, see what it found.",
  conflicts: "The review queue — work through what Canon would not decide on its own.",
  sources: "The systems Canon reads, their credentials, and synthetic datasets.",
  rules: "The survivorship policy that decides conflicts before any model is asked.",
  audit: "The append-only record of every decision, by the engine, the agent or a person.",
  docs: "How to use Canon, end to end.",
} as const;
