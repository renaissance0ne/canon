import "server-only";
import { connection } from "next/server";
import { and, desc, eq, max, sql } from "drizzle-orm";
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
 *
 * Policy is per account, so every query is scoped by `ownerId` and the argument
 * is required rather than optional — see the note in sources.ts.
 */

export async function listRulesets(ownerId: string): Promise<Ruleset[]> {
  await connection();

  const rows = await getDb()
    .select()
    .from(rulesets)
    .where(eq(rulesets.ownerId, ownerId))
    .orderBy(rulesets.name, desc(rulesets.version));

  return rows.map((row) => rulesetSchema.parse(row));
}

/** What a new run defaults to. Null before this account has authored a policy. */
export async function getActiveRuleset(ownerId: string): Promise<Ruleset | null> {
  await connection();

  const [row] = await getDb()
    .select()
    .from(rulesets)
    .where(and(eq(rulesets.ownerId, ownerId), eq(rulesets.isActive, true)))
    .orderBy(desc(rulesets.version))
    .limit(1);

  return row ? rulesetSchema.parse(row) : null;
}

export async function getRuleset(id: string, ownerId: string): Promise<Ruleset | null> {
  await connection();

  const [row] = await getDb()
    .select()
    .from(rulesets)
    .where(and(eq(rulesets.id, id), eq(rulesets.ownerId, ownerId)))
    .limit(1);

  return row ? rulesetSchema.parse(row) : null;
}

/**
 * "Save as v4" — appends the next version of a named policy and makes it
 * active. The previous version is not touched apart from its active flag: v3
 * stays readable, and any run that cites it still resolves to the exact rules
 * it ran.
 *
 * Version numbers are per OWNER and per NAME, assigned here inside the same
 * transaction that inserts the row, so two concurrent saves cannot both become
 * v4 — and two accounts that both call their policy "Default" each get their
 * own v1 rather than one inheriting the other's history.
 */
export async function createRulesetVersion(
  input: CreateRuleset,
  ownerId: string,
): Promise<Ruleset> {
  const db = getDb();

  const row = await db.transaction(async (tx) => {
    // Lock the family so the max-version read and the insert cannot interleave
    // with another save of the same policy. Transaction-scoped: released on
    // commit or rollback, with no unlock call to forget.
    //
    // Keyed on owner AND name: locking on the name alone would serialise every
    // account that happens to have picked the same policy name.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId + ":" + input.name}))`);

    const [{ highest }] = await tx
      .select({ highest: max(rulesets.version) })
      .from(rulesets)
      .where(and(eq(rulesets.ownerId, ownerId), eq(rulesets.name, input.name)));

    // Exactly one ruleset is active PER ACCOUNT: "the policy" is singular in
    // the console, and a run that had to choose between two active ones would
    // be choosing arbitrarily. Scoped to the owner — an unscoped update here
    // would let one account's save silently deactivate everyone else's policy.
    await tx
      .update(rulesets)
      .set({ isActive: false })
      .where(and(eq(rulesets.ownerId, ownerId), eq(rulesets.isActive, true)));

    const [inserted] = await tx
      .insert(rulesets)
      .values({
        ownerId,
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
