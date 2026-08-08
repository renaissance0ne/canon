import "server-only";
import { connection } from "next/server";
import { aliasedTable, and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  conflicts,
  entities,
  matches,
  resolutions,
  type EntityFields,
} from "@/lib/db/schema";
import { childKey, countChildrenByParent } from "@/lib/server/entities";
import { getRuleset } from "@/lib/server/rulesets";
import { getLatestRunWithConflicts, getRunDetail } from "@/lib/server/runs";
import { checkObservedValue } from "@/lib/validate-value";
import {
  EMPTY_SEVERITY_BREAKDOWN,
  severitySchema,
  type Severity,
} from "@/types/conflict";
import {
  QUEUE_PAGE_SIZE,
  QUEUE_STATUS_MATCHES,
  type ConflictSide,
  type QueueCounts,
  type QueueQuery,
  type QueueRow,
} from "@/types/queue";
import {
  REVIEW_AUDIT_ACTION,
  REVIEW_RESULT_STATUS,
  type ResolutionStatus,
  type ReviewAction,
} from "@/types/resolution";
import type { RuleStrategy, SurvivorshipRule } from "@/types/rules";
import type { RunDetail } from "@/types/run";
import { appendAudit } from "@/lib/server/audit";
import type { Reviewer } from "@/lib/server/auth";

/**
 * SERVER ONLY — the conflict queue (wireframes 1i–1m).
 *
 * `conflicts`, `matches` and `entities` are ENGINE-OWNED: read here, never
 * written. `resolutions` is the one shared row — the engine proposes, this file
 * records what a human decided about the proposal. Nothing in here updates a
 * proposal itself: `proposedValue`, `rationale` and `confidence` are what the
 * agent said, and rewriting them would make the audit trail a summary of the
 * present rather than a record of what happened.
 */

const entityA = aliasedTable(entities, "entity_a");
const entityB = aliasedTable(entities, "entity_b");

/**
 * A queue row's five tables, joined once.
 *
 * `resolutions` is a LEFT join: a conflict detected but not yet resolved still
 * belongs in the queue. Dropping it would make a mid-pipeline run look like it
 * found less than it did.
 *
 * This assumes ONE resolution per conflict, which is what the schema means by
 * "the proposed and final answer for a conflict" — but it is not yet enforced by
 * a unique index on `resolutions.conflict_id`. If the engine ever wrote two, this
 * join would show the conflict twice and the counts would double. Worth a unique
 * index; that is a migration, and a migration is a decision about the schema
 * rather than about this screen.
 */
const queueColumns = {
  conflictId: conflicts.id,
  runId: conflicts.runId,
  field: conflicts.field,
  valueA: conflicts.valueA,
  valueB: conflicts.valueB,
  conflictClass: conflicts.conflictClass,
  severity: conflicts.severity,
  detectedBy: conflicts.detectedBy,

  matchConfidence: matches.confidence,
  matchMethod: matches.method,
  matchSignals: matches.signals,

  aSourceId: entityA.sourceId,
  aExternalId: entityA.externalId,
  aFields: entityA.fields,
  aEntityType: entityA.entityType,
  aLastModifiedAt: entityA.lastModifiedAt,

  bSourceId: entityB.sourceId,
  bExternalId: entityB.externalId,
  bFields: entityB.fields,
  bEntityType: entityB.entityType,
  bLastModifiedAt: entityB.lastModifiedAt,

  resolutionId: resolutions.id,
  proposedValue: resolutions.proposedValue,
  rationale: resolutions.rationale,
  appliedRuleId: resolutions.appliedRuleId,
  confidence: resolutions.confidence,
  status: resolutions.status,
  reviewedBy: resolutions.reviewedBy,
  overrideValue: resolutions.overrideValue,
  reviewedAt: resolutions.reviewedAt,
};

function baseQuery() {
  return getDb()
    .select(queueColumns)
    .from(conflicts)
    .innerJoin(matches, eq(conflicts.matchId, matches.id))
    .innerJoin(entityA, eq(matches.entityAId, entityA.id))
    .innerJoin(entityB, eq(matches.entityBId, entityB.id))
    .leftJoin(resolutions, eq(resolutions.conflictId, conflicts.id));
}

async function selectQueueRows(query: QueueQuery, runId: string) {
  return baseQuery()
    .where(and(eq(conflicts.runId, runId), ...filters(query)))
    // Severity first, then confidence, exactly as the dense view says it sorts.
    // NULLS LAST because an unresolved conflict has no confidence, and a run
    // still resolving should not lead the queue with rows nobody can act on.
    .orderBy(
      desc(conflicts.severity),
      sql`${resolutions.confidence} desc nulls last`,
      asc(conflicts.field),
      // A stable tiebreak, or page 2 could repeat a row from page 1.
      asc(conflicts.id),
    )
    .limit(QUEUE_PAGE_SIZE)
    .offset((query.page - 1) * QUEUE_PAGE_SIZE);
}

type QueueSelect = Awaited<ReturnType<typeof selectQueueRows>>[number];

/**
 * Everything except the run, which is always applied.
 *
 * `omit` exists for the counts: a chip that counted only what the chip already
 * selected would always read the same number as the list under it.
 */
function filters(query: QueueQuery, omit?: "status" | "severities") {
  const clauses = [];

  const statuses = QUEUE_STATUS_MATCHES[query.status];
  if (statuses && omit !== "status") {
    clauses.push(inArray(resolutions.status, [...statuses]));
  }
  if (query.severities.length > 0 && omit !== "severities") {
    clauses.push(inArray(conflicts.severity, query.severities));
  }
  if (query.conflictClass) clauses.push(eq(conflicts.conflictClass, query.conflictClass));
  if (query.field) clauses.push(eq(conflicts.field, query.field));

  return clauses;
}

export type QueuePage = {
  rows: QueueRow[];
  counts: QueueCounts;
  /** Rows matching the current filter, for "12 of 61" and the pager. */
  total: number;
  page: number;
  pageCount: number;
};

/**
 * One page of the queue, plus the counts the filter chips read.
 *
 * Three round trips, not three hundred: the rows, the counts, and one grouped
 * child-count lookup for the entities on this page. A reviewer working 400
 * conflicts should not be paying for a query per row.
 */
export async function getQueuePage(
  query: QueueQuery,
  run: RunDetail,
  ruleset: SurvivorshipRule[],
): Promise<QueuePage> {
  await connection();

  const [rows, counts, total] = await Promise.all([
    selectQueueRows(query, run.id),
    getQueueCounts(query, run.id),
    countFiltered(query, run.id),
  ]);

  // Depends on which rows came back, so it cannot join the batch above. One
  // grouped query for the whole page.
  const childCounts = await countChildrenByParent(
    run.id,
    rows.flatMap((row) => [row.aExternalId, row.bExternalId]),
  );
  const strategies = ruleStrategies(ruleset);

  return {
    rows: rows.map((row) => toQueueRow(row, run, childCounts, strategies)),
    counts,
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE)),
  };
}

export type QueueLoad =
  | { state: "no-runs" }
  | { state: "ready"; run: RunDetail; page: QueuePage };

/**
 * The queue, resolved end to end: which run, which policy version, which page.
 *
 * Shared by the screen and by GET /api/conflicts so the two cannot drift — a
 * filter that means one thing in a link and another in the API is a bug that
 * only shows up in a bug report.
 *
 * The ruleset is loaded because a resolution records WHICH rule fired, not what
 * that rule was. Reading the strategy out of the version the run actually
 * executed is the only way "most_recent · 0.91" on the row can be trusted;
 * reading it from the active ruleset would relabel old runs every time policy
 * changes.
 */
export async function loadQueue(query: QueueQuery): Promise<QueueLoad> {
  const run = query.runId
    ? await getRunDetail(query.runId)
    : await getLatestRunWithConflicts();

  if (!run) return { state: "no-runs" };

  const ruleset = await getRuleset(run.rulesetId);
  const page = await getQueuePage(query, run, ruleset?.rules ?? []);

  return { state: "ready", run, page };
}

async function countFiltered(query: QueueQuery, runId: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(conflicts)
    .leftJoin(resolutions, eq(resolutions.conflictId, conflicts.id))
    .where(and(eq(conflicts.runId, runId), ...filters(query)));

  return row?.total ?? 0;
}

/**
 * The chip counts. Each facet is counted with every filter applied EXCEPT its
 * own — so the severity marks tell you what is in the pile you are working, and
 * the status chips tell you how much of your severity selection sits in each
 * pile. A facet counted with itself applied always reads back the list length,
 * which tells a reviewer nothing.
 */
async function getQueueCounts(query: QueueQuery, runId: string): Promise<QueueCounts> {
  const [byStatus, bySeverity] = await Promise.all([
    getDb()
      .select({ status: resolutions.status, total: count() })
      .from(conflicts)
      .leftJoin(resolutions, eq(resolutions.conflictId, conflicts.id))
      .where(and(eq(conflicts.runId, runId), ...filters(query, "status")))
      .groupBy(resolutions.status),

    getDb()
      .select({ severity: conflicts.severity, total: count() })
      .from(conflicts)
      .leftJoin(resolutions, eq(resolutions.conflictId, conflicts.id))
      .where(and(eq(conflicts.runId, runId), ...filters(query, "severities")))
      .groupBy(conflicts.severity),
  ]);

  const severityCounts = { ...EMPTY_SEVERITY_BREAKDOWN };
  for (const row of bySeverity) {
    const severity = severitySchema.safeParse(row.severity);
    if (severity.success) severityCounts[severity.data] = row.total;
  }

  let escalated = 0;
  let autoApplied = 0;
  let all = 0;
  for (const row of byStatus) {
    all += row.total;
    if (row.status === "escalated") escalated = row.total;
    if (row.status === "auto_applied") autoApplied = row.total;
  }

  return { escalated, autoApplied, all, bySeverity: severityCounts };
}

/** appliedRuleId → strategy, from the ruleset version the run actually used. */
function ruleStrategies(rules: SurvivorshipRule[]): Map<string, RuleStrategy> {
  return new Map(rules.map((rule) => [rule.id, rule.strategy]));
}

/**
 * One joined row → one queue row.
 *
 * The two interesting judgements are here:
 *
 * PRESENCE. An `orphan` is a record one side does not have, and the engine
 * records the absent side's value as empty. Presence is therefore read off the
 * conflict's own values rather than off the join — `conflicts.matchId` is NOT
 * NULL, so an orphan still points at a match, and whatever the engine puts on
 * the other end of it is not a claim that a record exists there.
 *
 * SIDES. Which entity is "A" is the engine's ordering, not an assumption: the
 * label follows each entity's own sourceId back to the run. If the engine ever
 * emits them the other way round, the column headers stay correct.
 */
function toQueueRow(
  row: QueueSelect,
  run: RunDetail,
  childCounts: Map<string, number>,
  strategies: Map<string, RuleStrategy>,
): QueueRow {
  const isOrphan = row.conflictClass === "orphan";
  const aValues = splitValues(row.valueA);
  const bValues = splitValues(row.valueB);

  const a: ConflictSide = {
    sourceId: row.aSourceId,
    sourceName: sourceName(row.aSourceId, run),
    externalId: row.aExternalId,
    name: row.aFields.name,
    values: aValues,
    lastModifiedAt: row.aLastModifiedAt,
    modifiedBy: modifiedBy(row.aFields),
    present: !isOrphan || aValues.length > 0,
  };

  const b: ConflictSide = {
    sourceId: row.bSourceId,
    sourceName: sourceName(row.bSourceId, run),
    externalId: row.bExternalId,
    name: row.bFields.name,
    values: bValues,
    lastModifiedAt: row.bLastModifiedAt,
    modifiedBy: modifiedBy(row.bFields),
    present: !isOrphan || bValues.length > 0,
  };

  // The row is filed under whichever side actually holds a record. For an
  // orphan present only in the warehouse, side A has nothing to name it with.
  const identity = a.present ? a : b;
  const identityType = a.present ? row.aEntityType : row.bEntityType;

  return {
    conflictId: row.conflictId,
    runId: row.runId,
    field: row.field,
    conflictClass: row.conflictClass,
    severity: row.severity,
    detectedBy: row.detectedBy,
    entityType: identityType,
    externalId: identity.externalId,
    entityName: identity.name,
    childCount: childCounts.get(childKey(identity.sourceId, identity.externalId)) ?? 0,
    a,
    b,
    matchConfidence: row.matchConfidence,
    matchMethod: row.matchMethod,
    matchSignals: row.matchSignals,
    resolution:
      row.resolutionId === null
        ? null
        : {
            id: row.resolutionId,
            proposedValue: row.proposedValue ?? "",
            rationale: row.rationale ?? "",
            appliedRuleId: row.appliedRuleId,
            appliedRuleStrategy:
              row.appliedRuleId === null
                ? null
                : strategies.get(row.appliedRuleId) ?? null,
            confidence: row.confidence ?? 0,
            status: row.status ?? "proposed",
            reviewedBy: row.reviewedBy,
            overrideValue: row.overrideValue,
            reviewedAt: row.reviewedAt,
          },
  };
}

/**
 * `conflicts.valueA` is one text column, and a `duplicate` has two records on
 * one side. The engine's convention is one value per line; an empty column is
 * no values at all, which is what an absent side looks like.
 */
function splitValues(value: string): string[] {
  return value
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function sourceName(sourceId: string, run: RunDetail): string {
  if (sourceId === run.sourceAId) return run.sourceAName;
  if (sourceId === run.sourceBId) return run.sourceBName;
  // A conflict whose entity belongs to neither of the run's sources is an engine
  // bug. Render something true rather than mislabelling it as one of the two.
  return "unknown source";
}

/** Optional provenance: "modified 2d ago · by ops@" (1j). Absent in most sources. */
function modifiedBy(fields: EntityFields): string | null {
  const value = fields.attributes?.lastModifiedBy;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The single row a review acts on, with everything the write needs to check. */
export type ReviewTarget = {
  conflictId: string;
  runId: string;
  field: string;
  externalId: string;
  severity: Severity;
  observed: string[];
  resolution: {
    id: string;
    proposedValue: string;
    appliedRuleId: string | null;
    confidence: number;
    status: ResolutionStatus;
  } | null;
};

export async function getReviewTarget(conflictId: string): Promise<ReviewTarget | null> {
  const [row] = await baseQuery().where(eq(conflicts.id, conflictId)).limit(1);
  if (!row) return null;

  return {
    conflictId: row.conflictId,
    runId: row.runId,
    field: row.field,
    externalId: row.aExternalId,
    severity: row.severity,
    observed: [...splitValues(row.valueA), ...splitValues(row.valueB)],
    resolution:
      row.resolutionId === null
        ? null
        : {
            id: row.resolutionId,
            proposedValue: row.proposedValue ?? "",
            appliedRuleId: row.appliedRuleId,
            confidence: row.confidence ?? 0,
            status: row.status ?? "proposed",
          },
  };
}

export type ReviewOutcome =
  | { ok: true; status: ResolutionStatus }
  | { ok: false; code: 400 | 404 | 409; message: string };

/**
 * Record one human decision (wireframes 1i, 1j, 1k, 1l).
 *
 * Three things this deliberately does NOT do:
 *
 * 1. It does not touch `proposedValue`, `rationale`, `confidence` or
 *    `appliedRuleId`. The proposal is not deleted when a human disagrees with
 *    it — both values stay on the record, which is what makes the override
 *    reviewable later.
 * 2. It does not accept a `reviewedBy` from the caller. The reviewer comes from
 *    the session; see lib/server/auth.ts.
 * 3. It does not let an override introduce a value neither source held. That is
 *    the same rule the engine's `validate` node applies to the model, and there
 *    is no reason a human hand should be exempt from it — a parent id nobody
 *    ever recorded breaks the same rollups either way.
 */
export async function recordReview({
  conflictId,
  action,
  reviewer,
}: {
  conflictId: string;
  action: ReviewAction;
  reviewer: Reviewer;
}): Promise<ReviewOutcome> {
  const target = await getReviewTarget(conflictId);
  if (!target) return { ok: false, code: 404, message: "No such conflict." };

  if (!target.resolution) {
    return {
      ok: false,
      code: 409,
      message: "Nothing has been proposed for this conflict yet — the run is still resolving.",
    };
  }

  const { resolution } = target;
  const status = REVIEW_RESULT_STATUS[action.action];

  // Approving nothing is not a decision. When a rule said `escalate`, no value
  // was ever proposed, and the only way forward is to choose one of the two
  // observed values — which is an override, and is recorded as one.
  if (action.action === "approve" && resolution.proposedValue.length === 0) {
    return {
      ok: false,
      code: 409,
      message:
        "No value was proposed for this conflict. Choose one of the two observed values instead.",
    };
  }

  let overrideValue: string | null = null;
  if (action.action === "override") {
    const check = checkObservedValue(action.overrideValue, target.observed);
    if (!check.ok) return { ok: false, code: 400, message: check.reason };
    // Stored as the observed value it folds onto, not as typed: a resolved
    // hierarchy full of hand-typed capitalisation variants is a new conflict.
    overrideValue = check.matches;
  }

  const chosenValue = action.action === "override" ? overrideValue : resolution.proposedValue;
  const reviewedAt = new Date();

  await getDb()
    .update(resolutions)
    .set({
      status,
      reviewedBy: reviewer.label,
      reviewedAt,
      // Cleared when a reviewer moves off an override, so the row never shows a
      // chosen value that no longer stands.
      overrideValue,
    })
    .where(eq(resolutions.id, resolution.id));

  await appendAudit({
    runId: target.runId,
    resolutionId: resolution.id,
    action: REVIEW_AUDIT_ACTION[action.action],
    actor: reviewer.label,
    detail: {
      conflictId: target.conflictId,
      externalId: target.externalId,
      field: target.field,
      severity: target.severity,
      proposedValue: resolution.proposedValue || null,
      chosenValue: action.action === "reject" ? null : chosenValue,
      appliedRuleId: resolution.appliedRuleId,
      confidence: resolution.confidence,
      // What it was before, so an approved conflict still explains where the
      // agent's proposal came from.
      previousStatus: resolution.status,
      note: action.note && action.note.length > 0 ? action.note : null,
    },
  });

  return { ok: true, status };
}
