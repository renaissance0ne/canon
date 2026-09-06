import "server-only";
import { connection } from "next/server";
import { and, count, desc, eq, getTableColumns } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, runs } from "@/lib/db/schema";
import { auditEntrySchema, type AuditAction, type AuditEntry } from "@/types/resolution";

/**
 * SERVER ONLY — the append-only audit writer.
 *
 * `audit_log` is the one table with no update and no delete path anywhere in
 * this codebase, and that is deliberate: the trail is the product. If a
 * decision can be quietly rewritten, none of the earlier ones mean anything.
 *
 * Both layers append. The engine writes what the pipeline did; the web layer
 * writes what a human did, plus the two events a human causes directly —
 * starting a run, and a dispatch that never reached the engine.
 *
 * `audit_log` has no owner column: an entry belongs to whoever owns its run.
 * The two read paths that a client can point anywhere — the audit screen and
 * its export — therefore join `runs` and filter on `runs.owner_id`. Without
 * that, an audit screen with no run filter is a list of every decision every
 * account has ever made.
 */

type AppendArgs = {
  runId: string;
  action: AuditAction;
  /** "engine" | "agent" | a reviewer identifier. Never client-supplied. */
  actor: string;
  detail?: Record<string, unknown>;
  resolutionId?: string | null;
};

export async function appendAudit({
  runId,
  action,
  actor,
  detail = {},
  resolutionId = null,
}: AppendArgs): Promise<void> {
  await getDb().insert(auditLog).values({ runId, action, actor, detail, resolutionId });
}

/**
 * Oldest first — a timeline reads down, in the order things happened.
 *
 * Takes no owner: its only caller is the run detail screen, which reached this
 * `runId` through `getRunDetail(runId, ownerId)` and therefore already knows
 * the run is this account's. Do not call it with an unchecked id.
 */
export async function listRunAudit(runId: string): Promise<AuditEntry[]> {
  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(eq(auditLog.runId, runId))
    .orderBy(auditLog.createdAt);

  return rows.map((row) => auditEntrySchema.parse(row));
}

/** Newest first, for "what happened last" across this account's runs. */
export async function listRecentAudit(ownerId: string, limit = 50): Promise<AuditEntry[]> {
  const rows = await getDb()
    .select(getTableColumns(auditLog))
    .from(auditLog)
    .innerJoin(runs, eq(auditLog.runId, runs.id))
    .where(eq(runs.ownerId, ownerId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map((row) => auditEntrySchema.parse(row));
}

/** One page's worth. The trail outlives any single screen, so it is paged. */
export const AUDIT_PAGE_SIZE = 100;

export type AuditFilter = {
  /** Required. The trail is scoped to one account, never to "all of them". */
  ownerId: string;
  runId?: string;
  action?: AuditAction;
  page?: number;
};

export type AuditPage = {
  entries: AuditEntry[];
  /** Entries matching the filter — the "442 entries" in wireframe 1n. */
  total: number;
  page: number;
  pageCount: number;
  /** How many of each action exist, ignoring the action filter itself. */
  byAction: Partial<Record<AuditAction, number>>;
};

/**
 * The owner clause is first and unconditional. `runId` and `action` are filters
 * a reader chose; ownership is not a filter and there is no code path that can
 * drop it — which is why it lives here rather than at each call site.
 */
function auditFilters({ ownerId, runId, action }: AuditFilter, omitAction = false) {
  const clauses = [eq(runs.ownerId, ownerId)];
  if (runId) clauses.push(eq(auditLog.runId, runId));
  if (action && !omitAction) clauses.push(eq(auditLog.action, action));
  return clauses;
}

/**
 * Wireframe 1n — the audit screen.
 *
 * Newest first here, unlike `listRunAudit`: the run screen's timeline is a
 * narrative and reads down, but the audit trail is a ledger and the question
 * asked of it is almost always "what just happened".
 *
 * Ordered by `createdAt` then `id`: several rows can share a timestamp (the
 * engine appends `auto_applied` and `escalated` in the same instant), and
 * without a tiebreak page 2 could repeat a row from page 1.
 */
export async function getAuditPage(filter: AuditFilter): Promise<AuditPage> {
  await connection();

  const page = Math.max(1, filter.page ?? 1);
  const db = getDb();

  const [entries, [totals], actionCounts] = await Promise.all([
    db
      .select(getTableColumns(auditLog))
      .from(auditLog)
      .innerJoin(runs, eq(auditLog.runId, runs.id))
      .where(and(...auditFilters(filter)))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE),

    db
      .select({ total: count() })
      .from(auditLog)
      .innerJoin(runs, eq(auditLog.runId, runs.id))
      .where(and(...auditFilters(filter))),

    db
      .select({ action: auditLog.action, total: count() })
      .from(auditLog)
      .innerJoin(runs, eq(auditLog.runId, runs.id))
      .where(and(...auditFilters(filter, true)))
      .groupBy(auditLog.action),
  ]);

  const total = totals?.total ?? 0;

  return {
    entries: entries.map((row) => auditEntrySchema.parse(row)),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    byAction: Object.fromEntries(actionCounts.map((row) => [row.action, row.total])),
  };
}

/**
 * The whole filtered trail, for the export in wireframe 1n. Not paged: a log
 * you can only download 100 rows of is not the artefact a reviewer asked for.
 */
export async function listAuditForExport(filter: AuditFilter): Promise<AuditEntry[]> {
  const rows = await getDb()
    .select(getTableColumns(auditLog))
    .from(auditLog)
    .innerJoin(runs, eq(auditLog.runId, runs.id))
    .where(and(...auditFilters(filter)))
    // Oldest first in the file: a log read outside the console is read forwards.
    .orderBy(auditLog.createdAt, auditLog.id);

  return rows.map((row) => auditEntrySchema.parse(row));
}
