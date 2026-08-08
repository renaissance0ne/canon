import "server-only";
import { aliasedTable, and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conflicts, entities, matches, resolutions } from "@/lib/db/schema";
import { childKey, countAccounts, countChildrenByParent } from "@/lib/server/entities";
import type { ConflictClass } from "@/types/conflict";
import type { RunDetail, RunStats } from "@/types/run";

/**
 * SERVER ONLY — the export in wireframe 1g.
 *
 * Two halves, and both matter:
 *
 *   hierarchy  what the org looks like once Canon's decisions are applied
 *   decisions  why it looks that way — every conflict, every rationale, every
 *              human who touched it
 *
 * The second half is the reason this exists. A resolved hierarchy on its own is
 * just another opinion about the org; shipped next to the decision log it is
 * defensible, which is the entire product.
 *
 * v1 does NOT write back to Salesforce or the warehouse. This file is the only
 * thing that leaves the system, and it leaves as a file.
 */

/** One row of the decision log: a conflict and whatever became of it. */
export type DecisionRow = {
  conflictId: string;
  externalId: string;
  entityName: string;
  entityType: string;
  field: string;
  valueA: string;
  valueB: string;
  conflictClass: string;
  severity: number;
  detectedBy: string;
  /** Null until the resolve stage has reached this conflict. */
  status: string | null;
  proposedValue: string | null;
  /** What a human chose instead, when they overrode. */
  overrideValue: string | null;
  /** The value actually applied — null when nothing was. */
  appliedValue: string | null;
  appliedRuleId: string | null;
  confidence: number | null;
  rationale: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

/** One account after Canon's decisions are applied to it. */
export type HierarchyRow = {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  /** True when a resolution changed this edge from what side A held. */
  reparented: boolean;
};

/**
 * A record one side does not have (wireframe 1m, exported as its own section in
 * 1o). It is in the decision log too, but as a conflict row — a reader
 * reconciling head counts wants the list, not a filter expression.
 */
export type OrphanRow = {
  externalId: string;
  name: string;
  entityType: string;
  /** The source that holds the record. */
  presentIn: string;
  /** The source that does not. */
  absentFrom: string;
  childCount: number;
  severity: number;
};

export type RunExport = {
  run: {
    id: string;
    status: string;
    sourceA: string;
    sourceB: string;
    ruleset: string;
    startedAt: string;
    finishedAt: string | null;
  };
  exportedAt: string;
  exportedBy: string;
  /** Which sections were asked for — the file says what it does and does not hold. */
  sections: ExportSection[];
  hierarchy?: HierarchyRow[];
  decisions?: DecisionRow[];
  orphans?: OrphanRow[];
  stats?: RunStats;
};

/**
 * The four checkboxes in wireframe 1o. Two are ticked by default because they
 * are the export: what the org looks like, and why it looks that way.
 */
export const EXPORT_SECTIONS = ["hierarchy", "decisions", "orphans", "stats"] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export const DEFAULT_EXPORT_SECTIONS: readonly ExportSection[] = ["hierarchy", "decisions"];

export function isExportSection(value: string): value is ExportSection {
  return (EXPORT_SECTIONS as readonly string[]).includes(value);
}

/**
 * A resolution counts as applied only in these states. `escalated`, `proposed`
 * and `rejected` leave the source value standing — Canon does not apply a value
 * nobody accepted, and an escalation that silently took effect would defeat the
 * point of escalating.
 */
const APPLIED_STATUSES = new Set(["auto_applied", "approved", "overridden"]);

const entityA = aliasedTable(entities, "entity_a");
const entityB = aliasedTable(entities, "entity_b");

export async function buildRunExport(
  run: RunDetail,
  exportedBy: string,
  sections: readonly ExportSection[] = DEFAULT_EXPORT_SECTIONS,
): Promise<RunExport> {
  const wants = new Set(sections);

  // The hierarchy is built by applying decisions to side A, so the decisions are
  // read whenever either section is asked for — and only attached to the file
  // when the decision log itself was.
  const needsDecisions = wants.has("decisions") || wants.has("hierarchy");

  const [decisions, accounts, orphans] = await Promise.all([
    needsDecisions ? loadDecisions(run.id) : Promise.resolve([]),
    wants.has("hierarchy")
      ? loadSideAAccounts(run.id, run.sourceAId)
      : Promise.resolve([]),
    wants.has("orphans") ? loadOrphans(run) : Promise.resolve([]),
  ]);

  return {
    run: {
      id: run.id,
      status: run.status,
      sourceA: run.sourceAName,
      sourceB: run.sourceBName,
      ruleset: `${run.rulesetName} v${run.rulesetVersion}`,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    },
    exportedAt: new Date().toISOString(),
    exportedBy,
    sections: [...sections],
    ...(wants.has("hierarchy") ? { hierarchy: applyDecisions(accounts, decisions) } : {}),
    ...(wants.has("decisions") ? { decisions } : {}),
    ...(wants.has("orphans") ? { orphans } : {}),
    ...(wants.has("stats") ? { stats: run.stats } : {}),
  };
}

async function loadDecisions(runId: string): Promise<DecisionRow[]> {
  const rows = await getDb()
    .select({
      conflictId: conflicts.id,
      field: conflicts.field,
      valueA: conflicts.valueA,
      valueB: conflicts.valueB,
      conflictClass: conflicts.conflictClass,
      severity: conflicts.severity,
      detectedBy: conflicts.detectedBy,
      externalId: entityA.externalId,
      entityFields: entityA.fields,
      entityType: entityA.entityType,
      status: resolutions.status,
      proposedValue: resolutions.proposedValue,
      overrideValue: resolutions.overrideValue,
      appliedRuleId: resolutions.appliedRuleId,
      confidence: resolutions.confidence,
      rationale: resolutions.rationale,
      reviewedBy: resolutions.reviewedBy,
      reviewedAt: resolutions.reviewedAt,
    })
    .from(conflicts)
    .innerJoin(matches, eq(conflicts.matchId, matches.id))
    .innerJoin(entityA, eq(matches.entityAId, entityA.id))
    .innerJoin(entityB, eq(matches.entityBId, entityB.id))
    // Left, not inner: a conflict detected but not yet resolved still belongs
    // in the log. Omitting it would make the export look cleaner than the run.
    .leftJoin(resolutions, eq(resolutions.conflictId, conflicts.id))
    .where(eq(conflicts.runId, runId))
    // Highest severity first, same as the queue. A reader opening the CSV in a
    // spreadsheet sees what breaks rollups before what changes capitalisation.
    .orderBy(desc(conflicts.severity), conflicts.field);

  return rows.map((row) => ({
    conflictId: row.conflictId,
    externalId: row.externalId,
    entityName: row.entityFields.name,
    entityType: row.entityType,
    field: row.field,
    valueA: row.valueA,
    valueB: row.valueB,
    conflictClass: row.conflictClass,
    severity: row.severity,
    detectedBy: row.detectedBy,
    status: row.status,
    proposedValue: row.proposedValue,
    overrideValue: row.overrideValue,
    appliedValue: appliedValue(row.status, row.proposedValue, row.overrideValue),
    appliedRuleId: row.appliedRuleId,
    confidence: row.confidence,
    rationale: row.rationale,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  }));
}

function appliedValue(
  status: string | null,
  proposedValue: string | null,
  overrideValue: string | null,
): string | null {
  if (!status || !APPLIED_STATUSES.has(status)) return null;
  return status === "overridden" ? overrideValue : proposedValue;
}

/**
 * The records one side does not have.
 *
 * Which side is missing is read off the conflict's own values, not off the join:
 * `conflicts.matchId` is NOT NULL, so an orphan still points at a match, and
 * whatever sits on the other end of it is not a claim that a record exists
 * there. An empty value column is what "absent" looks like in the schema.
 */
async function loadOrphans(run: RunDetail): Promise<OrphanRow[]> {
  const rows = await getDb()
    .select({
      valueA: conflicts.valueA,
      valueB: conflicts.valueB,
      severity: conflicts.severity,
      aSourceId: entityA.sourceId,
      aExternalId: entityA.externalId,
      aFields: entityA.fields,
      aEntityType: entityA.entityType,
      bSourceId: entityB.sourceId,
      bExternalId: entityB.externalId,
      bFields: entityB.fields,
      bEntityType: entityB.entityType,
    })
    .from(conflicts)
    .innerJoin(matches, eq(conflicts.matchId, matches.id))
    .innerJoin(entityA, eq(matches.entityAId, entityA.id))
    .innerJoin(entityB, eq(matches.entityBId, entityB.id))
    .where(and(eq(conflicts.runId, run.id), eq(conflicts.conflictClass, "orphan")))
    .orderBy(desc(conflicts.severity), entityA.externalId);

  const childCounts = await countChildrenByParent(
    run.id,
    rows.flatMap((row) => [row.aExternalId, row.bExternalId]),
  );

  const sourceName = (id: string) =>
    id === run.sourceAId ? run.sourceAName : id === run.sourceBId ? run.sourceBName : "unknown source";

  return rows.map((row) => {
    const aPresent = row.valueA.trim().length > 0;
    const present = aPresent
      ? {
          sourceId: row.aSourceId,
          externalId: row.aExternalId,
          name: row.aFields.name,
          entityType: row.aEntityType,
        }
      : {
          sourceId: row.bSourceId,
          externalId: row.bExternalId,
          name: row.bFields.name,
          entityType: row.bEntityType,
        };
    const absentSourceId = aPresent ? row.bSourceId : row.aSourceId;

    return {
      externalId: present.externalId,
      name: present.name,
      entityType: present.entityType,
      presentIn: sourceName(present.sourceId),
      absentFrom: sourceName(absentSourceId),
      childCount: childCounts.get(childKey(present.sourceId, present.externalId)) ?? 0,
      severity: row.severity,
    };
  });
}

/**
 * What each section of wireframe 1o weighs, before anything is downloaded.
 *
 * A reviewer ticking boxes on an export deserves to know what they are about to
 * pull. The counts are exact; the byte figure is an estimate and is labelled as
 * one at the call site — a real answer would mean serialising the whole file to
 * measure it, which is the download.
 */
export type ExportSizing = {
  hierarchy: number;
  decisions: number;
  orphans: number;
  /** Always one row. Present so the section list has a number in every line. */
  stats: number;
};

export async function getExportSizing(run: RunDetail): Promise<ExportSizing> {
  const [hierarchy, decisions, orphans] = await Promise.all([
    countAccounts(run.id, run.sourceAId),
    countConflicts(run.id),
    countConflicts(run.id, "orphan"),
  ]);

  return { hierarchy, decisions, orphans, stats: 1 };
}

async function countConflicts(
  runId: string,
  conflictClass?: ConflictClass,
): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(conflicts)
    .where(
      conflictClass
        ? and(eq(conflicts.runId, runId), eq(conflicts.conflictClass, conflictClass))
        : eq(conflicts.runId, runId),
    );

  return row?.total ?? 0;
}

/** Rough bytes per row, measured from the shapes above. Estimate, not a promise. */
const BYTES_PER_ROW: Record<ExportSection, number> = {
  hierarchy: 120,
  decisions: 640,
  orphans: 200,
  stats: 260,
};

export function estimateExportBytes(
  sizing: ExportSizing,
  sections: readonly ExportSection[],
): number {
  return sections.reduce(
    (total, section) => total + sizing[section] * BYTES_PER_ROW[section],
    0,
  );
}

/**
 * Side A is the CRM, and the CRM is where humans edit structure — so it is the
 * base the resolved hierarchy is built on. Side B contributes disagreements,
 * not a second tree.
 */
async function loadSideAAccounts(runId: string, sourceAId: string) {
  return getDb()
    .select({
      externalId: entities.externalId,
      fields: entities.fields,
      parentExternalId: entities.parentExternalId,
    })
    .from(entities)
    .where(
      and(
        eq(entities.runId, runId),
        eq(entities.sourceId, sourceAId),
        eq(entities.entityType, "account"),
      ),
    )
    .orderBy(entities.externalId);
}

type SideAAccount = Awaited<ReturnType<typeof loadSideAAccounts>>[number];

function applyDecisions(
  accounts: SideAAccount[],
  decisions: DecisionRow[],
): HierarchyRow[] {
  const resolvedParents = new Map<string, string>();
  for (const decision of decisions) {
    if (decision.field === "parentExternalId" && decision.appliedValue !== null) {
      resolvedParents.set(decision.externalId, decision.appliedValue);
    }
  }

  return accounts.map((account) => {
    const resolved = resolvedParents.get(account.externalId);
    return {
      externalId: account.externalId,
      name: account.fields.name,
      parentExternalId: resolved ?? account.parentExternalId,
      reparented: resolved !== undefined && resolved !== account.parentExternalId,
    };
  });
}

const DECISION_COLUMNS: readonly (keyof DecisionRow)[] = [
  "conflictId",
  "externalId",
  "entityName",
  "entityType",
  "field",
  "valueA",
  "valueB",
  "conflictClass",
  "severity",
  "detectedBy",
  "status",
  "proposedValue",
  "overrideValue",
  "appliedValue",
  "appliedRuleId",
  "confidence",
  "rationale",
  "reviewedBy",
  "reviewedAt",
];

/**
 * The decision log as CSV. The hierarchy is deliberately not folded into the
 * same file — one CSV holding two different row shapes is a spreadsheet nobody
 * can pivot. Take JSON when you want both.
 */
export function decisionsToCsv(decisions: DecisionRow[]): string {
  const lines = [DECISION_COLUMNS.join(",")];
  for (const decision of decisions) {
    lines.push(DECISION_COLUMNS.map((column) => csvCell(decision[column])).join(","));
  }
  // Trailing newline: POSIX text files end with one, and Excel does not care.
  return lines.join("\r\n") + "\r\n";
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
