import { z } from "zod";
import {
  conflictClassSchema,
  matchMethodSchema,
  matchSignalsSchema,
  severitySchema,
  type ConflictClass,
  type Severity,
} from "@/types/conflict";
import { resolutionStatusSchema, type ResolutionStatus } from "@/types/resolution";
import { ruleStrategySchema } from "@/types/rules";

/**
 * The conflict queue's read model (wireframes 1i, 1j, 1k, 1l, 1m).
 *
 * This is NOT part of the tool contract — the engine never sends or receives
 * it. It is one row of the review screen, assembled server-side from five
 * tables (`conflicts`, `matches`, both `entities` sides, `resolutions`) so a
 * queue of 400 costs a handful of queries rather than four per row.
 *
 * It lives in types/ rather than lib/server/ because Client Components import
 * it: the queue is keyboard-driven and the review controls submit, so the rows
 * cross into the browser. Nothing in lib/server/ may be imported from there.
 */

/** One side of the spine. The two are structurally identical, always. */
export const conflictSideSchema = z.object({
  sourceId: z.string().uuid(),
  /** "Salesforce (prod)" — the column header, resolved from the run. */
  sourceName: z.string(),
  externalId: z.string(),
  name: z.string(),
  /**
   * The disagreeing value(s) as the engine recorded them. More than one only
   * for `duplicate`, where two records on one side match one on the other.
   */
  values: z.array(z.string()),
  lastModifiedAt: z.coerce.date().nullable(),
  /** From `attributes.lastModifiedBy` when the source carries it (1j: "by ops@"). */
  modifiedBy: z.string().nullable(),
  /**
   * False when this side has no record at all — an `orphan`. The spine survives
   * it: the cell is hatched, never blank, so a missing value cannot read as a
   * rendering bug (1m).
   */
  present: z.boolean(),
});

export const queueResolutionSchema = z.object({
  id: z.string().uuid(),
  /** Empty when a rule said `escalate` — nothing was ever proposed. */
  proposedValue: z.string(),
  rationale: z.string(),
  appliedRuleId: z.string().nullable(),
  /** Resolved from the run's ruleset. Null when the id is not in that version. */
  appliedRuleStrategy: ruleStrategySchema.nullable(),
  confidence: z.number(),
  status: resolutionStatusSchema,
  reviewedBy: z.string().nullable(),
  overrideValue: z.string().nullable(),
  reviewedAt: z.coerce.date().nullable(),
});

export const queueRowSchema = z.object({
  conflictId: z.string().uuid(),
  runId: z.string().uuid(),
  field: z.string(),
  conflictClass: conflictClassSchema,
  severity: severitySchema,
  detectedBy: z.enum(["rule", "agent"]),
  /** Whose identity the row is filed under — side A when it exists, else B. */
  entityType: z.string(),
  externalId: z.string(),
  entityName: z.string(),
  /** Drives orphan severity (4 with children, 3 without) and reads in 1j. */
  childCount: z.number().int().nonnegative(),
  a: conflictSideSchema,
  b: conflictSideSchema,
  matchConfidence: z.number(),
  matchMethod: matchMethodSchema,
  matchSignals: matchSignalsSchema,
  /** Null until the resolve stage reaches this conflict. */
  resolution: queueResolutionSchema.nullable(),
});

export type ConflictSide = z.infer<typeof conflictSideSchema>;
export type QueueResolution = z.infer<typeof queueResolutionSchema>;
export type QueueRow = z.infer<typeof queueRowSchema>;

/**
 * The three status filters in 1i. Not a free-text status: these are the two
 * piles a run hands over plus everything, and a reviewer's job is the first.
 */
export const queueStatusFilterSchema = z.enum(["escalated", "auto_applied", "all"]);
export type QueueStatusFilter = z.infer<typeof queueStatusFilterSchema>;

export const QUEUE_STATUS_LABEL: Record<QueueStatusFilter, string> = {
  escalated: "Escalated",
  auto_applied: "Auto-applied",
  all: "All",
};

/** Which resolution statuses each filter admits. `all` filters nothing. */
export const QUEUE_STATUS_MATCHES: Record<
  QueueStatusFilter,
  readonly ResolutionStatus[] | null
> = {
  escalated: ["escalated"],
  auto_applied: ["auto_applied"],
  all: null,
};

/**
 * Three directions for the same screen, all three kept (wireframes 1i–1k).
 * They are not decoration: a 12-row queue and a 400-row queue want different
 * shapes, and which one a reviewer wants is their call, not the build's.
 *
 *   ledger  1i — one full diff unit per row, scroll-reviewed. Honest to spec,
 *                ~150px a conflict.
 *   focus   1j — list on the left, one hero diff on the right. Keyboard-first;
 *                the list never moves, so there is no re-anchoring.
 *   dense   1k — 36px rows, expand in place. 400 conflicts stay scannable.
 */
export const queueViewSchema = z.enum(["ledger", "focus", "dense"]);
export type QueueView = z.infer<typeof queueViewSchema>;

export const QUEUE_VIEWS: readonly { view: QueueView; label: string; hint: string }[] = [
  { view: "ledger", label: "Ledger", hint: "one full diff per row" },
  { view: "focus", label: "Focus", hint: "list + one hero diff" },
  { view: "dense", label: "Dense", hint: "36px rows, expand in place" },
];

/** One server render's worth. A queue of 400 is four pages, not four hundred rows. */
export const QUEUE_PAGE_SIZE = 100;

/**
 * The queue's URL. Filters live in the query string, not in component state, so
 * a reviewer can send someone "the 41 structural ones in this run" as a link —
 * which is how half of these conflicts actually get resolved.
 *
 * Severity arrives as `sev=4,3`: repeated params are uglier in a link and
 * `URLSearchParams` handles neither better.
 */
export const queueQuerySchema = z.object({
  runId: z.string().uuid().optional(),
  status: queueStatusFilterSchema.default("escalated"),
  severities: z
    .string()
    .optional()
    .transform((raw) =>
      (raw ?? "")
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((n): n is Severity => severitySchema.safeParse(n).success),
    ),
  /** A single class, from the 1j list ("show me only the duplicates"). */
  conflictClass: conflictClassSchema.optional(),
  field: z.string().max(80).optional(),
  view: queueViewSchema.default("ledger"),
  page: z.coerce.number().int().min(1).default(1),
  /** Which row the focus pane has open. Ignored by the other two views. */
  selected: z.string().uuid().optional(),
});

export type QueueQuery = z.infer<typeof queueQuerySchema>;

/** What a filtered read returns. Counts come from the same filter, minus itself. */
export type QueueCounts = {
  escalated: number;
  autoApplied: number;
  all: number;
  /** Conflicts per severity, within the current status filter. */
  bySeverity: Record<Severity, number>;
};

/**
 * The field cell. For a real field disagreement it is the field name; for the
 * two whole-record classes the field name is not the story (1m).
 */
export function conflictFieldLabel(row: {
  field: string;
  conflictClass: ConflictClass;
  a: { values: string[]; present: boolean };
  b: { values: string[]; present: boolean };
}): string {
  if (row.conflictClass === "orphan") return "entity absent";
  if (row.conflictClass === "duplicate") {
    const from = Math.max(row.a.values.length, row.b.values.length);
    const to = Math.min(row.a.values.length, row.b.values.length);
    return from > to && to > 0 ? `${from} → ${to}` : "duplicate record";
  }
  return row.field;
}

/**
 * Why this row is the severity it is, in one clause. Severity is a defined
 * integer, so it can always be explained — and on a screen with no color to
 * lean on, the explanation is what makes the mark mean something.
 */
export function severityReason(row: {
  conflictClass: ConflictClass;
  severity: Severity;
  childCount: number;
}): string {
  switch (row.conflictClass) {
    case "structural":
      return "changes the shape of the hierarchy — rollups read this edge";
    case "orphan":
      return row.childCount > 0
        ? `absent on one side and has ${row.childCount} ${row.childCount === 1 ? "child" : "children"}`
        : "absent on one side, no children";
    case "duplicate":
      return "two records match one — totals double-count silently";
    case "cosmetic":
      return "same value, different representation";
    default:
      return row.severity === 3
        ? "changes who owns or is credited for something"
        : "changes a non-rollup field";
  }
}
