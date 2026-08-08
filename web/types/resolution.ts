import { z } from "zod";

/** Tool contract — mirrors engine/pipeline/schema.py. */
export const resolutionStatusSchema = z.enum([
  "proposed",
  "auto_applied",
  "escalated",
  "approved",
  "rejected",
  "overridden",
]);

export const resolutionSchema = z.object({
  id: z.string().uuid(),
  conflictId: z.string().uuid(),
  proposedValue: z.string(),
  /** Plain-English, agent-authored. A reviewer decides from this in five seconds. */
  rationale: z.string(),
  /** Which survivorship rule fired, if any. */
  appliedRuleId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  status: resolutionStatusSchema,
  reviewedBy: z.string().nullable(),
  /** What the human chose instead. */
  overrideValue: z.string().nullable(),
  createdAt: z.coerce.date(),
  reviewedAt: z.coerce.date().nullable(),
});

/**
 * A reviewer's note. Lands in `audit_log.detail`, never on the resolution row —
 * it is a fact about a decision, not part of the decision, and audit detail is
 * the one place nothing can be rewritten later.
 */
const reviewNote = z.string().trim().max(500).optional();

/**
 * PATCH /api/conflicts/:conflictId/resolution. Every action appends to
 * audit_log — nothing is ever silently changed.
 *
 * `reviewedBy` is deliberately NOT in this body. The reviewer's identity is
 * resolved server-side from the session and written to `resolutions.reviewedBy`
 * and `audit_log.actor` there. An audit trail whose actor is whatever string
 * the client sent is not an audit trail, and "who approved this" is the
 * question the whole log exists to answer.
 */
export const reviewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), note: reviewNote }),
  z.object({ action: z.literal("reject"), note: reviewNote }),
  z.object({
    action: z.literal("override"),
    /**
     * Checked server-side against the two observed values before it is written
     * — the same rule the engine's `validate` node applies to the model. A
     * reviewer may not invent a parent id either (wireframe 1l).
     */
    overrideValue: z.string().min(1),
    note: reviewNote,
  }),
]);

export type ResolutionStatus = z.infer<typeof resolutionSchema>["status"];
export type Resolution = z.infer<typeof resolutionSchema>;
export type ReviewAction = z.infer<typeof reviewActionSchema>;
export type ReviewActionName = ReviewAction["action"];

/**
 * Append-only. Never updated, never deleted.
 *
 * `human_rejected` is the one action here that AGENTS.md § Database Schema does
 * not list. It has to exist: feature 14 is "approve / reject / override, each
 * appending to audit log", and a rejection recorded as anything else would put
 * a false statement in the one table that is supposed to be beyond dispute.
 * Mirrored in engine/pipeline/schema.py::AuditAction.
 */
export const auditActionSchema = z.enum([
  "run_started",
  "conflict_detected",
  "resolution_proposed",
  "auto_applied",
  "escalated",
  "human_approved",
  "human_rejected",
  "human_overridden",
  "run_failed",
]);

export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditEntrySchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  resolutionId: z.string().uuid().nullable(),
  action: auditActionSchema,
  /** "engine" | "agent" | a reviewer identifier. */
  actor: z.string(),
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** What the timeline reads. Past tense: every entry is a thing that happened. */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  run_started: "run started",
  conflict_detected: "conflicts detected",
  resolution_proposed: "resolutions proposed",
  auto_applied: "auto-applied",
  escalated: "escalated",
  human_approved: "approved",
  human_rejected: "rejected",
  human_overridden: "overridden",
  run_failed: "run failed",
};

/** Who can have caused each action. Drives the 1n filter, in this order. */
export const AUDIT_ACTIONS = auditActionSchema.options;

/** Which audit action a review writes. Approve / reject / override, one each. */
export const REVIEW_AUDIT_ACTION = {
  approve: "human_approved",
  reject: "human_rejected",
  override: "human_overridden",
} as const satisfies Record<ReviewActionName, AuditAction>;

/** What the resolution row's status becomes when a human decides. */
export const REVIEW_RESULT_STATUS = {
  approve: "approved",
  reject: "rejected",
  override: "overridden",
} as const satisfies Record<ReviewActionName, ResolutionStatus>;

/**
 * AGENTS.md § Encoding severity without color: resolution status uses SHAPE
 * rather than fill, because fill is already spoken for by severity and a
 * grayscale interface only has so many ways to say "different".
 *
 *   ◦ proposed · ● auto_applied · ■ escalated · ✓ approved · / rejected
 *   ■/ overridden — the escalated square with a rule through it
 *
 * Every glyph is rendered with its word, same rule as SeverityMark.
 */
export const RESOLUTION_STATUS_GLYPH: Record<ResolutionStatus, string> = {
  proposed: "◦",
  auto_applied: "●",
  escalated: "■",
  approved: "✓",
  rejected: "/",
  overridden: "■/",
};

export const RESOLUTION_STATUS_LABEL: Record<ResolutionStatus, string> = {
  proposed: "proposed",
  auto_applied: "auto-applied",
  escalated: "escalated",
  approved: "approved",
  rejected: "rejected",
  overridden: "overridden",
};

/**
 * A human has decided this one. Not "finished" — a decision can be revisited,
 * and every revisit appends another audit row — but the queue reads differently
 * once someone's name is on it.
 */
export function isHumanDecided(status: ResolutionStatus): boolean {
  return status === "approved" || status === "rejected" || status === "overridden";
}
