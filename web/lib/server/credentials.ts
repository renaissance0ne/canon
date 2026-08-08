import "server-only";
import { connection } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sourceCredentials, sources } from "@/lib/db/schema";
import { encryptSecrets, type SealedSecret } from "@/lib/server/crypto";
import {
  credentialStatusSchema,
  findAuthMethod,
  requiresCredentials,
  type AuthMethod,
  type CredentialStatus,
} from "@/types/credentials";
import type { SourceKind } from "@/types/source";

/**
 * The credential store. SERVER ONLY, and the only module that writes
 * `source_credentials`.
 *
 * The rule this file enforces, and the reason it is small: THERE IS NO READ
 * PATH THAT RETURNS A SECRET. `readStatus` returns which keys exist, not their
 * values. Nothing here decrypts. The engine decrypts, in its own process, and
 * that is the whole point of the split — a bug in a console screen cannot leak
 * a token, because the console never has one to leak.
 *
 * `sourceCredentials` is web-owned. The engine reads and decrypts it; it must
 * never write it, the same way it must never write `sources`. A run whose
 * credentials changed underneath it is a run that cannot be reproduced.
 */

/** What a write needs. `secrets` is the half that gets encrypted. */
export type StoreCredentialInput = {
  sourceId: string;
  kind: SourceKind;
  method: AuthMethod;
  publicValues: Record<string, string>;
  secrets: Record<string, string>;
  /** Clerk user id, from the session. Never from a request body. */
  connectedBy: string;
  /** OAuth only. */
  expiresAt?: Date | null;
  scope?: string | null;
};

export type StoreResult =
  | { ok: true; status: CredentialStatus }
  | { ok: false; code: number; message: string };

/**
 * Write (or replace) one source's credentials.
 *
 * Replace, not append: the unique index on `source_id` means reconnecting
 * overwrites. Two live grants for one source would make "which one did the run
 * use?" unanswerable, which is the same reason rulesets are versioned rather
 * than mutable — except here the old value is a secret, so keeping history
 * would mean keeping a revoked token decryptable forever.
 *
 * Splitting `values` into public and secret is NOT the caller's choice. It is
 * read off the schema, so a field marked `secret` in `@/types/credentials` is
 * encrypted no matter what any call site believes.
 */
export async function storeCredentials(input: StoreCredentialInput): Promise<StoreResult> {
  const spec = findAuthMethod(input.kind, input.method);
  if (!spec) {
    return {
      ok: false,
      code: 400,
      message: `${input.kind} does not support ${input.method}.`,
    };
  }

  const sealed = encryptSecrets(input.secrets, { sourceId: input.sourceId });

  const [row] = await getDb()
    .insert(sourceCredentials)
    .values({
      sourceId: input.sourceId,
      method: input.method,
      publicValues: input.publicValues,
      connectedBy: input.connectedBy,
      expiresAt: input.expiresAt ?? null,
      scope: input.scope ?? null,
      ...sealed,
    })
    .onConflictDoUpdate({
      target: sourceCredentials.sourceId,
      set: {
        method: input.method,
        publicValues: input.publicValues,
        connectedBy: input.connectedBy,
        expiresAt: input.expiresAt ?? null,
        scope: input.scope ?? null,
        // Cleared on every write. It is a claim about the credential that is
        // being replaced, and carrying it forward would show a fresh, untested
        // credential as verified.
        lastVerifiedAt: null,
        updatedAt: new Date(),
        ...sealed,
      },
    })
    .returning();

  return { ok: true, status: toStatus(row, input.kind) };
}

/**
 * The redacted view. The only thing any GET is allowed to return.
 *
 * `secretKeys` is names, never values — enough for the console to render
 * "token · stored" and no more. There is deliberately no masked-value variant:
 * a masked value still has to travel over the wire to get masked.
 */
export async function readStatus(sourceId: string): Promise<CredentialStatus | null> {
  await connection();

  // Joined rather than denormalized: `kind` lives on `sources` and is what
  // selects the spec that says which fields are secret. Copying it onto this
  // row would create a second place for the two to disagree, and the
  // disagreement would be "Canon encrypted the wrong field".
  const [row] = await getDb()
    .select({ credential: sourceCredentials, kind: sources.kind })
    .from(sourceCredentials)
    .innerJoin(sources, eq(sources.id, sourceCredentials.sourceId))
    .where(eq(sourceCredentials.sourceId, sourceId))
    .limit(1);

  return row ? toStatus(row.credential, row.kind) : null;
}

/**
 * Every stored credential, redacted, keyed by source id — plus the clock.
 *
 * One query rather than one per source: the sources list renders this for every
 * row, and N round trips to answer "is it connected?" is the wrong shape for a
 * table.
 *
 * `now` is returned alongside because expiry is the one thing the table renders
 * that depends on the current time, and reading a clock inside a component —
 * server or client — makes its output depend on when React happened to run.
 * Reading it here, in an async data-access function, keeps render pure.
 */
export async function listCredentialStatuses(): Promise<{
  bySourceId: Map<string, CredentialStatus>;
  now: number;
}> {
  await connection();

  const rows = await getDb()
    .select({ credential: sourceCredentials, kind: sources.kind })
    .from(sourceCredentials)
    .innerJoin(sources, eq(sources.id, sourceCredentials.sourceId));

  return {
    bySourceId: new Map(
      rows.map((row) => [row.credential.sourceId, toStatus(row.credential, row.kind)]),
    ),
    now: Date.now(),
  };
}

/** Which of these sources have credentials. One round trip, for the sources table. */
export async function findConfiguredSourceIds(sourceIds: string[]): Promise<Set<string>> {
  if (sourceIds.length === 0) return new Set();

  const rows = await getDb()
    .select({ sourceId: sourceCredentials.sourceId })
    .from(sourceCredentials)
    .where(inArray(sourceCredentials.sourceId, sourceIds));

  return new Set(rows.map((row) => row.sourceId));
}

/**
 * Disconnect. Deletes the row outright rather than flagging it revoked.
 *
 * A "revoked" credential still decrypts, so a soft delete would mean the
 * ciphertext of a token someone explicitly disconnected stays in the database
 * indefinitely. The audit trail records that a disconnect happened; it does not
 * need to keep the secret to prove it.
 */
export async function deleteCredentials(sourceId: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(sourceCredentials)
    .where(eq(sourceCredentials.sourceId, sourceId))
    .returning({ id: sourceCredentials.id });

  return deleted.length > 0;
}

/**
 * Whether a run may start against this source.
 *
 * A run that begins and dies at the extract step because nobody connected
 * Salesforce wastes the whole pipeline and leaves a failed row to explain.
 * Checking here makes it a 400 on the button press instead.
 */
export async function credentialsMissingFor(
  sources: { id: string; kind: SourceKind; name: string }[],
): Promise<string[]> {
  const needing = sources.filter((source) => requiresCredentials(source.kind));
  if (needing.length === 0) return [];

  const configured = await findConfiguredSourceIds(needing.map((source) => source.id));
  return needing.filter((source) => !configured.has(source.id)).map((source) => source.name);
}

/**
 * OAuth access tokens expire. This is what the console reads to say so before a
 * run does — a grant whose refresh token was revoked at the provider looks
 * identical to a healthy one until something tries to use it.
 */
export function isExpired(status: CredentialStatus, now: Date = new Date()): boolean {
  return status.expiresAt !== null && status.expiresAt.getTime() <= now.getTime();
}

/** The row as the API is allowed to describe it. Every secret column is dropped here. */
type CredentialRow = typeof sourceCredentials.$inferSelect;

function toStatus(row: CredentialRow, kind: SourceKind): CredentialStatus {
  return credentialStatusSchema.parse({
    sourceId: row.sourceId,
    method: row.method,
    publicValues: row.publicValues,
    secretKeys: secretKeyNames(kind, row.method),
    expiresAt: row.expiresAt,
    scope: row.scope,
    lastVerifiedAt: row.lastVerifiedAt,
    updatedAt: row.updatedAt,
    connectedBy: row.connectedBy,
  });
}

/**
 * Which secrets this credential holds, derived from the schema rather than by
 * decrypting — describing a credential must never require opening it, or this
 * module's one rule would be pointless.
 *
 * OAuth is the exception because its keys are minted by the callback rather
 * than declared as form fields: there is nothing in `fields` to read them off.
 */
function secretKeyNames(kind: SourceKind, method: AuthMethod): string[] {
  if (method === "oauth2") return ["accessToken", "refreshToken"];

  const spec = findAuthMethod(kind, method);
  if (!spec) return [];

  return spec.fields.filter((field) => field.sensitivity === "secret").map((field) => field.key);
}

export type { SealedSecret };
