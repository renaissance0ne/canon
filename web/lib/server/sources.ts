import "server-only";
import { connection } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { sourceSchema, type CreateSource, type Source } from "@/types/source";

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
    .where(eq(sources.ownerId, ownerId))
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
    .where(and(eq(sources.id, id), eq(sources.ownerId, ownerId)))
    .limit(1);

  return row ? sourceSchema.parse(row) : null;
}

/** Which of the given ids this account actually owns — one round trip. */
export async function findSourceIds(ids: string[], ownerId: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const rows = await getDb()
    .select({ id: sources.id })
    .from(sources)
    .where(and(inArray(sources.id, ids), eq(sources.ownerId, ownerId)));

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
