import "server-only";
import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { entities } from "@/lib/db/schema";

/**
 * SERVER ONLY — reads over the normalized entity table.
 *
 * `entities` is ENGINE-OWNED. Nothing in the web layer writes it; these are the
 * two facts several screens need about the hierarchy itself rather than about a
 * conflict, and they live here so the conflict queue and the export do not each
 * grow their own copy of the same aggregate.
 */

/** `sourceId:externalId` — the same id exists on both sides with different children. */
export function childKey(sourceId: string, externalId: string): string {
  return `${sourceId}:${externalId}`;
}

/**
 * How many children each of `externalIds` has, per source.
 *
 * One grouped query for a whole page of conflicts. Orphan severity is 4 with
 * children and 3 without, so a reviewer deciding on a missing account has to
 * know whether four child accounts are about to roll up to nothing (1m) — and
 * that must not cost a query per row.
 */
export async function countChildrenByParent(
  runId: string,
  externalIds: string[],
): Promise<Map<string, number>> {
  const parents = [...new Set(externalIds)].filter((id) => id.length > 0);
  if (parents.length === 0) return new Map();

  const rows = await getDb()
    .select({
      sourceId: entities.sourceId,
      parentExternalId: entities.parentExternalId,
      total: count(),
    })
    .from(entities)
    .where(and(eq(entities.runId, runId), inArray(entities.parentExternalId, parents)))
    .groupBy(entities.sourceId, entities.parentExternalId);

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.parentExternalId === null) continue;
    map.set(childKey(row.sourceId, row.parentExternalId), row.total);
  }
  return map;
}

/** Rows in the resolved hierarchy: side A's accounts (wireframe 1o's count). */
export async function countAccounts(runId: string, sourceId: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(entities)
    .where(
      and(
        eq(entities.runId, runId),
        eq(entities.sourceId, sourceId),
        eq(entities.entityType, "account"),
      ),
    );

  return row?.total ?? 0;
}
