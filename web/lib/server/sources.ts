import "server-only";
import { connection } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { sourceSchema, type CreateSource, type Source } from "@/types/source";

/**
 * Server Component data access. Everything in the console is a Server
 * Component; TanStack Query is reserved for run-status polling only.
 *
 * `sources` is web-owned: the engine reads this table but must never write it.
 */
export async function listSources(): Promise<Source[]> {
  // Configured sources are request-time state, not build-time. `connection()`
  // stops prerendering here, so every consumer of this function is dynamic and
  // no page bakes in the source list it happened to see at build.
  await connection();

  const rows = await getDb().select().from(sources).orderBy(sources.createdAt);
  return rows.map((row) => sourceSchema.parse(row));
}

export async function countSourcesBySide() {
  const all = await listSources();
  return {
    crm: all.filter((s) => s.kind === "salesforce" || s.kind === "hubspot").length,
    warehouse: all.filter((s) => s.kind === "databricks" || s.kind === "snowflake").length,
    synthetic: all.filter((s) => s.kind === "synthetic").length,
  };
}

export async function getSource(id: string): Promise<Source | null> {
  await connection();

  const [row] = await getDb().select().from(sources).where(eq(sources.id, id)).limit(1);
  return row ? sourceSchema.parse(row) : null;
}

/** Which of the given ids actually exist — one round trip, for run validation. */
export async function findSourceIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const rows = await getDb()
    .select({ id: sources.id })
    .from(sources)
    .where(inArray(sources.id, ids));

  return new Set(rows.map((row) => row.id));
}

/**
 * Wireframe 1c. `config` holds non-secret connection shape only — object names,
 * table names, filters. Credentials live in the engine's environment keyed by
 * `kind`, and `createSourceSchema` has no field that could carry one, so a
 * password cannot reach this table even by accident.
 */
export async function createSource(input: CreateSource): Promise<Source> {
  const [row] = await getDb().insert(sources).values(input).returning();
  return sourceSchema.parse(row);
}
