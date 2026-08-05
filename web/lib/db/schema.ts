import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
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

/**
 * The single source of truth for Canon's schema. Drizzle owns it; the engine
 * reads and writes the same Postgres but never migrates it.
 *
 * Two writers, split by TABLE OWNERSHIP — this is what keeps runs
 * reproducible, and it is not enforced by the network topology:
 *
 *   sources     web only                    (engine must never write)
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
  /** NEVER credentials. Secrets live in the engine env, keyed by `kind`. */
  config: jsonb("config").$type<SourceConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
