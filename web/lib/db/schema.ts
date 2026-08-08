import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { CanonicalEntity } from "@/types/entity";
import type { SurvivorshipRule } from "@/types/rules";
import type { RunStats, RunStatus } from "@/types/run";
import type {
  ConflictClass,
  MatchMethod,
  MatchSignals,
  Severity,
} from "@/types/conflict";
import type { AuditAction, ResolutionStatus } from "@/types/resolution";
import type { SourceConfig, SourceKind } from "@/types/source";
import type { AuthMethod } from "@/types/credentials";

/**
 * The single source of truth for Canon's schema. Drizzle owns it; the engine
 * reads and writes the same Postgres but never migrates it.
 *
 * Two writers, split by TABLE OWNERSHIP — this is what keeps runs
 * reproducible, and it is not enforced by the network topology:
 *
 *   sources             web only            (engine must never write)
 *   source_credentials  web only            (engine reads and decrypts; never writes)
 *   rulesets    web only                    (engine must never write)
 *   runs        web creates, engine updates status
 *   entities    engine only                 (web must never write)
 *   matches     engine only                 (web must never write)
 *   conflicts   engine only                 (web must never write)
 *   resolutions engine proposes, web records human review
 *   audit_log   both, append-only           (never updated, never deleted)
 */

/** A configured system Canon reads from. Non-secret connection shape only. */
export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind").$type<SourceKind>().notNull(),
  /**
   * NEVER credentials. Object names, table names, filters — nothing else.
   * Secrets live one table down in `source_credentials`, encrypted, and there
   * is no field here a password could travel in even by accident.
   */
  config: jsonb("config").$type<SourceConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One source's credentials. The only table in Canon that holds a secret.
 *
 * This replaced the per-integration keys that used to sit in the engine's
 * `.env` (`SALESFORCE_PASSWORD`, `DATABRICKS_TOKEN`, …). Those could not
 * express two Salesforce orgs, could not be rotated without a deploy, and gave
 * every run the same identity regardless of who started it.
 *
 * The AGENTS.md rule they existed to satisfy is intact and is in fact stronger
 * here: a credential is still never in `sources.config`, is still never
 * readable by the web layer's own UI, and now additionally is never readable by
 * anyone holding only a database dump. What moved is the storage location, not
 * the trust boundary.
 *
 *   ciphertext   AES-256-GCM over the JSON secret bundle
 *   iv           96-bit nonce, fresh per write, never reused under a key
 *   authTag      128-bit GCM tag — tamper-evidence, not just confidentiality
 *   keyVersion   which root key this row was sealed under, so rotation is
 *                a background re-encrypt rather than a flag day
 *
 * Written by the web layer only. The engine decrypts and reads; it must never
 * write here, the same way it must never write `sources` — a run whose
 * credentials changed underneath it is a run that cannot be reproduced.
 */
export const sourceCredentials = pgTable(
  "source_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** Which shape of `@/types/credentials` this row holds. */
    method: text("method").$type<AuthMethod>().notNull(),
    /**
     * Non-secret connection shape: hostnames, HTTP paths, warehouse names. In
     * clear because the console displays them back and the OAuth authorize URL
     * is built from them.
     */
    publicValues: jsonb("public_values").$type<Record<string, string>>().notNull().default({}),
    /** Base64 AES-256-GCM ciphertext of the secret bundle. */
    ciphertext: text("ciphertext").notNull(),
    /** Base64 96-bit nonce. Fresh on every write — GCM nonce reuse is fatal. */
    iv: text("iv").notNull(),
    /** Base64 128-bit GCM auth tag. */
    authTag: text("auth_tag").notNull(),
    /** Root key generation. Lets a rotation re-encrypt row by row. */
    keyVersion: integer("key_version").notNull().default(1),
    /** OAuth only — when the access token dies and the refresh token is spent. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** OAuth only — what the provider actually granted, which is not always what was asked. */
    scope: text("scope"),
    /**
     * The Clerk user whose grant this is. Answers "whose access did this run
     * use?", which is the credential half of the question `audit_log.actor`
     * answers for decisions.
     */
    connectedBy: text("connected_by").notNull(),
    /** Last successful connection, stamped by the engine's preflight. */
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One credential per source. Reconnecting replaces the row rather than
    // adding a second — two live grants for one source would make "which one
    // did the run use?" unanswerable.
    uniqueIndex("source_credentials_source_idx").on(table.sourceId),
  ],
);

/**
 * Survivorship rules, versioned. Never edited in place: a run records which
 * rulesetId it used, and mutable rules would make past runs unreproducible.
 */
export const rulesets = pgTable("rulesets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  rules: jsonb("rules").$type<SurvivorshipRule[]>().notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One reconciliation execution. */
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The CRM side. */
  sourceAId: uuid("source_a_id")
    .notNull()
    .references(() => sources.id),
  /** The warehouse side. */
  sourceBId: uuid("source_b_id")
    .notNull()
    .references(() => sources.id),
  rulesetId: uuid("ruleset_id")
    .notNull()
    .references(() => rulesets.id),
  status: text("status").$type<RunStatus>().notNull().default("queued"),
  stats: jsonb("stats").$type<RunStats>().notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/**
 * The parts of a CanonicalEntity that are not promoted to their own column.
 * externalId, entityType, parentExternalId and lastModifiedAt are columns
 * because matching and survivorship read them directly.
 */
export type EntityFields = Pick<
  CanonicalEntity,
  "name" | "normalizedName" | "attributes"
>;

/** Normalized records from both sides, per run. Written by the engine only. */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    /** The id in the source system. */
    externalId: text("external_id").notNull(),
    entityType: text("entity_type").$type<CanonicalEntity["entityType"]>().notNull(),
    fields: jsonb("fields").$type<EntityFields>().notNull(),
    /** The hierarchy edge. */
    parentExternalId: text("parent_external_id"),
    /** Drives recency survivorship. */
    lastModifiedAt: timestamp("last_modified_at", { withTimezone: true }),
  },
  (table) => [index("entities_run_source_external_idx").on(table.runId, table.sourceId, table.externalId)],
);

/** A pair of entities believed to be the same real-world thing. */
export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id),
  entityAId: uuid("entity_a_id")
    .notNull()
    .references(() => entities.id),
  entityBId: uuid("entity_b_id")
    .notNull()
    .references(() => entities.id),
  /** 0..1 */
  confidence: real("confidence").notNull(),
  method: text("method").$type<MatchMethod>().notNull(),
  signals: jsonb("signals").$type<MatchSignals>().notNull(),
});

/** A field-level disagreement within a match. */
export const conflicts = pgTable("conflicts", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id),
  field: text("field").notNull(),
  valueA: text("value_a").notNull(),
  valueB: text("value_b").notNull(),
  conflictClass: text("conflict_class").$type<ConflictClass>().notNull(),
  /** 1..4 — see AGENTS.md § Severity Model. Read by the auto-apply gate. */
  severity: integer("severity").$type<Severity>().notNull(),
  detectedBy: text("detected_by").$type<"rule" | "agent">().notNull(),
});

/** The proposed and final answer for a conflict. */
export const resolutions = pgTable("resolutions", {
  id: uuid("id").primaryKey().defaultRandom(),
  conflictId: uuid("conflict_id")
    .notNull()
    .references(() => conflicts.id),
  /** `validate` guarantees this is an observed value or a legal normalization. */
  proposedValue: text("proposed_value").notNull(),
  /** Plain-English, agent-authored. */
  rationale: text("rationale").notNull(),
  /** Which survivorship rule fired, if any. */
  appliedRuleId: text("applied_rule_id"),
  /** 0..1 */
  confidence: real("confidence").notNull(),
  status: text("status").$type<ResolutionStatus>().notNull().default("proposed"),
  reviewedBy: text("reviewed_by"),
  /** What the human chose instead. */
  overrideValue: text("override_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

/** Append-only. Never updated, never deleted — the audit trail is the product. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id),
  resolutionId: uuid("resolution_id").references(() => resolutions.id),
  action: text("action").$type<AuditAction>().notNull(),
  /** "engine" | "agent" | a reviewer identifier. */
  actor: text("actor").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
