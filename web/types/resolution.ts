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
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject") }),
  z.object({
    action: z.literal("override"),
    overrideValue: z.string().min(1),
  }),
]);

export type ResolutionStatus = z.infer<typeof resolutionSchema>["status"];
export type Resolution = z.infer<typeof resolutionSchema>;
export type ReviewAction = z.infer<typeof reviewActionSchema>;

/** Append-only. Never updated, never deleted. */
export const auditActionSchema = z.enum([
  "run_started",
  "conflict_detected",
  "resolution_proposed",
  "auto_applied",
  "escalated",
  "human_approved",
  "human_overridden",
  "run_failed",
]);

export type AuditAction = z.infer<typeof auditActionSchema>;
