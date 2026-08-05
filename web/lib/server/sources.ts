import "server-only";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { sourceSchema, type Source } from "@/types/source";

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
