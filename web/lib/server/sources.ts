import "server-only";
import { connection } from "next/server";
import { and, count, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { runs, sourceCredentials, sources } from "@/lib/db/schema";
import { sourceSchema, type CreateSource, type Source } from "@/types/source";

/**
 * Archived sources are invisible to every read in this module — lists, the
 * single read the run route and the connect screens use, and the ownership
 * check. That is what makes archiving mean "cannot start a run": the run route
 * resolves both sources through `getSource`, and an archived one reads as gone.
 * Past runs still name their sources, because run queries join on the id.
 */
const LIVE = isNull(sources.archivedAt);

/**
 * Server Component data access. Everything in the console is a Server
 * Component; TanStack Query is reserved for run-status polling only.
 *
 * `sources` is web-owned: the engine reads this table but must never write it.
 *
 * Every function here takes an `ownerId` and none of them is optional. That is
 * deliberate: authentication only establishes that SOMEONE is signed in, and a
 * gate that stops there hands every account the whole table. Making the scope a
 * required argument means a new call site that forgets it fails to compile
 * rather than silently reading across accounts.
 */
export async function listSources(ownerId: string): Promise<Source[]> {
  // Configured sources are request-time state, not build-time. `connection()`
  // stops prerendering here, so every consumer of this function is dynamic and
  // no page bakes in the source list it happened to see at build.
  await connection();

  const rows = await getDb()
    .select()
    .from(sources)
    .where(and(eq(sources.ownerId, ownerId), LIVE))
    .orderBy(sources.createdAt);

  return rows.map((row) => sourceSchema.parse(row));
}

export async function countSourcesBySide(ownerId: string) {
  const all = await listSources(ownerId);
  return {
    crm: all.filter((s) => s.kind === "salesforce" || s.kind === "hubspot").length,
    warehouse: all.filter((s) => s.kind === "databricks" || s.kind === "snowflake").length,
    synthetic: all.filter((s) => s.kind === "synthetic").length,
  };
}

/**
 * Null for a source this account does not own, exactly as for one that does not
 * exist. The two are the same answer on purpose — a 404 that distinguishes them
 * confirms the row is real, which is the whole of what an id-guessing probe is
 * trying to learn.
 */
export async function getSource(id: string, ownerId: string): Promise<Source | null> {
  await connection();

  const [row] = await getDb()
    .select()
    .from(sources)
    .where(and(eq(sources.id, id), eq(sources.ownerId, ownerId), LIVE))
    .limit(1);

  return row ? sourceSchema.parse(row) : null;
}

/** Which of the given ids this account actually owns — one round trip. */
export async function findSourceIds(ids: string[], ownerId: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const rows = await getDb()
    .select({ id: sources.id })
    .from(sources)
    .where(and(inArray(sources.id, ids), eq(sources.ownerId, ownerId), LIVE));

  return new Set(rows.map((row) => row.id));
}

/**
 * Wireframe 1c. `config` holds non-secret connection shape only — object names,
 * table names, filters. Credentials live in `source_credentials`, encrypted,
 * and `createSourceSchema` has no field that could carry one, so a password
 * cannot reach this table even by accident.
 *
 * `ownerId` comes from the session, never from the body — the same rule that
 * governs `audit_log.actor`. A client that could name its own owner could name
 * someone else's.
 */
export async function createSource(input: CreateSource, ownerId: string): Promise<Source> {
  const [row] = await getDb()
    .insert(sources)
    .values({ ...input, ownerId })
    .returning();

  return sourceSchema.parse(row);
}

/**
 * How many runs read each of this account's sources, as either side.
 *
 * The Sources screen shows it beside the remove control, because it decides
 * what removing does — and a reviewer should know before they confirm, not
 * after.
 */
export async function countRunsBySource(ownerId: string): Promise<Map<string, number>> {
  const db = getDb();
  const [asA, asB] = await Promise.all([
    db
      .select({ sourceId: runs.sourceAId, n: count() })
      .from(runs)
      .where(eq(runs.ownerId, ownerId))
      .groupBy(runs.sourceAId),
    db
      .select({ sourceId: runs.sourceBId, n: count() })
      .from(runs)
      .where(eq(runs.ownerId, ownerId))
      .groupBy(runs.sourceBId),
  ]);

  const counts = new Map<string, number>();
  for (const { sourceId, n } of [...asA, ...asB]) {
    counts.set(sourceId, (counts.get(sourceId) ?? 0) + n);
  }
  return counts;
}

export type RemoveSourceOutcome =
  | { outcome: "deleted" }
  | { outcome: "archived"; runs: number };

/**
 * Remove a source: delete it if no run ever read it, archive it if one did.
 *
 * A used source cannot be deleted. `runs` and `entities` reference it, so the
 * database would refuse — and forcing it would mean deleting those runs, their
 * conflicts and decisions, and the audit trail AGENTS.md says is never deleted.
 * Archiving keeps all of that readable while taking the source out of every
 * list and out of the new-run form. Its stored credentials are deleted either
 * way: a source that can never run again has no reason to keep a secret.
 *
 * One transaction, and the source row is locked first. Creating a run takes a
 * key-share lock on each source it references, so the lock here makes "count
 * the runs, then delete" atomic — a run cannot appear between the two and turn
 * the delete into a foreign-key failure.
 *
 * Returns null for a source this account does not own or has already removed,
 * the same answer as for one that never existed.
 */
export async function removeSource(
  id: string,
  ownerId: string,
): Promise<RemoveSourceOutcome | null> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.id, id), eq(sources.ownerId, ownerId), LIVE))
      .for("update");
    if (!row) return null;

    const [{ n: runCount }] = await tx
      .select({ n: count() })
      .from(runs)
      .where(or(eq(runs.sourceAId, id), eq(runs.sourceBId, id)));

    if (runCount === 0) {
      // `source_credentials` cascades on this delete.
      await tx.delete(sources).where(eq(sources.id, id));
      return { outcome: "deleted" as const };
    }

    await tx.update(sources).set({ archivedAt: new Date() }).where(eq(sources.id, id));
    await tx.delete(sourceCredentials).where(eq(sourceCredentials.sourceId, id));
    return { outcome: "archived" as const, runs: runCount };
  });
}
