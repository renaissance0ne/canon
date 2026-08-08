import "server-only";
import { connection } from "next/server";
import { desc, eq, max, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { rulesets } from "@/lib/db/schema";
import { rulesetSchema, type CreateRuleset, type Ruleset } from "@/types/rules";

/**
 * SERVER ONLY — survivorship policy.
 *
 * `rulesets` is web-owned: the engine reads it and must never write it.
 *
 * Rulesets are VERSIONED, NEVER EDITED IN PLACE. A run records the `rulesetId`
 * it executed under; if the rules behind that id could change, every past run
 * would silently stop being reproducible and the audit trail would be a lie.
 * There is deliberately no update path in this file — only `createVersion`.
 */

export async function listRulesets(): Promise<Ruleset[]> {
  await connection();

  const rows = await getDb()
    .select()
    .from(rulesets)
    .orderBy(rulesets.name, desc(rulesets.version));

  return rows.map((row) => rulesetSchema.parse(row));
}

/** What a new run defaults to. Null before any policy has been authored. */
export async function getActiveRuleset(): Promise<Ruleset | null> {
  await connection();

  const [row] = await getDb()
    .select()
    .from(rulesets)
    .where(eq(rulesets.isActive, true))
    .orderBy(desc(rulesets.version))
    .limit(1);

  return row ? rulesetSchema.parse(row) : null;
}

export async function getRuleset(id: string): Promise<Ruleset | null> {
  await connection();

  const [row] = await getDb().select().from(rulesets).where(eq(rulesets.id, id)).limit(1);
  return row ? rulesetSchema.parse(row) : null;
}

/**
 * "Save as v4" — appends the next version of a named policy and makes it
 * active. The previous version is not touched apart from its active flag: v3
 * stays readable, and any run that cites it still resolves to the exact rules
 * it ran.
 *
 * Version numbers are per-name and assigned here, inside the same transaction
 * that inserts the row, so two concurrent saves cannot both become v4.
 */
export async function createRulesetVersion(input: CreateRuleset): Promise<Ruleset> {
  const db = getDb();

  const row = await db.transaction(async (tx) => {
    // Lock the family so the max-version read and the insert cannot interleave
    // with another save of the same policy. Transaction-scoped: released on
    // commit or rollback, with no unlock call to forget.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.name}))`);

    const [{ highest }] = await tx
      .select({ highest: max(rulesets.version) })
      .from(rulesets)
      .where(eq(rulesets.name, input.name));

    // Exactly one ruleset is active across the whole install: "the policy" is
    // singular in the console, and a run that had to choose between two active
    // ones would be choosing arbitrarily.
    await tx.update(rulesets).set({ isActive: false }).where(eq(rulesets.isActive, true));

    const [inserted] = await tx
      .insert(rulesets)
      .values({
        name: input.name,
        version: (highest ?? 0) + 1,
        rules: input.rules,
        isActive: true,
      })
      .returning();

    return inserted;
  });

  return rulesetSchema.parse(row);
}
