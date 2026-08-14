"""Postgres writer — OWNED TABLES ONLY.

The engine connects to the same Postgres the web layer does and writes its own
run output. Streaming thousands of rows back over HTTP for the web layer to
insert would add a hop, a serialization cost and a failure mode for no benefit.

The boundary is enforced by TABLE OWNERSHIP, not by network topology:

    entities      engine only    ← written here
    matches       engine only    ← written here
    conflicts     engine only    ← written here
    resolutions   engine proposes; the web layer records human review
    runs          status updates only — never the source or ruleset columns
    audit_log     append-only, both layers

    sources            WEB ONLY — the engine must NEVER write this
    rulesets           WEB ONLY — the engine must NEVER write this
    source_credentials WEB ONLY — read and decrypted in credentials.py; the one
                       write the engine makes there is `last_verified_at`,
                       which records a connection attempt rather than changing
                       the credential

Violating that split makes runs non-reproducible. Drizzle owns the schema;
nothing here migrates it.

Every statement in this module names its columns explicitly. `SELECT *` would
couple the engine to Drizzle's column ORDER, which a migration is free to
change without telling anyone.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from pipeline.credentials import SealedCredentialRow
from pipeline.normalize import entity_uuid
from pipeline.schema import (
    AuditAction,
    CanonicalEntity,
    Conflict,
    Match,
    Resolution,
    RunStats,
    RunStatus,
    SurvivorshipRule,
)

#: Rows per round trip. Large enough that a 50k-entity run is a handful of
#: statements, small enough that one batch's parameters stay well inside
#: Postgres' 65535-parameter ceiling.
_BATCH = 500


class RunConfigError(RuntimeError):
    """A run row references configuration that is missing or unusable."""


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RunConfigError(
            "DATABASE_URL is not set. The engine writes its own run output, so it "
            "needs the same Postgres the web layer migrates — see engine/.env.example."
        )
    return url


@contextmanager
def connect() -> Iterator[psycopg.Connection[Any]]:
    """One connection, committed on clean exit and rolled back on failure.

    A new connection per unit of work rather than a pool: a run is a handful of
    batched statements spread over minutes, so pooling would optimize the part
    of this that was never the cost, and a long-lived handle across a stage that
    can raise is a transaction nobody closed.

    ``prepare_threshold=None`` disables psycopg's automatic server-side prepared
    statements. It is not a performance preference — ``DATABASE_URL`` points at
    Supabase's TRANSACTION pooler, which hands each transaction whatever backend
    is free, so a statement prepared on one is not there on the next and the
    name collides instead. This is the same constraint the web layer satisfies
    with Drizzle's ``prepare: false``; both sides talk to the same pooler and
    both have to honour it.
    """
    with psycopg.connect(_database_url(), prepare_threshold=None) as conn:
        yield conn


# ── Reads (web-owned config — read freely, write never) ──────────────────────


def load_run_config(run_id: UUID) -> tuple[UUID, UUID, UUID]:
    """``run_id`` → (source_a_id, source_b_id, ruleset_id).

    Everything a run needs is read from Postgres, not from the request body:
    two sources of truth for what a run executed would break reproducibility.
    """
    with connect() as conn:
        row = conn.execute(
            "SELECT source_a_id, source_b_id, ruleset_id FROM runs WHERE id = %s",
            (run_id,),
        ).fetchone()

    if row is None:
        raise RunConfigError(f"No run {run_id}. The web layer creates the row before dispatching.")

    return (row[0], row[1], row[2])


def load_ruleset(ruleset_id: UUID) -> list[SurvivorshipRule]:
    """Read a versioned ruleset. Never mutate it — past runs must still reproduce."""
    with connect() as conn:
        row = conn.execute("SELECT rules FROM rulesets WHERE id = %s", (ruleset_id,)).fetchone()

    if row is None:
        raise RunConfigError(f"No ruleset {ruleset_id}.")

    rules = row[0]
    if not isinstance(rules, list):
        raise RunConfigError(f"Ruleset {ruleset_id} does not hold a list of rules.")

    # Validated rather than trusted: the column is jsonb, so nothing in the
    # database guarantees the shape the resolver is about to rely on.
    return [SurvivorshipRule.model_validate(rule) for rule in rules]


def load_source(source_id: UUID) -> tuple[str, dict[str, object]]:
    """``source_id`` → (kind, config).

    ``config`` is non-secret connection shape only — object names, table names,
    filters. The credential half is read by ``credentials.load_credentials``,
    which is the only module that holds key material.
    """
    with connect() as conn:
        row = conn.execute(
            "SELECT kind, config FROM sources WHERE id = %s", (source_id,)
        ).fetchone()

    if row is None:
        raise RunConfigError(f"No source {source_id}.")

    config = row[1] if isinstance(row[1], dict) else {}
    return (str(row[0]), config)


def load_source_name(source_id: UUID) -> str:
    """The console's label for a source. Used in rationales a human reads."""
    with connect() as conn:
        row = conn.execute("SELECT name FROM sources WHERE id = %s", (source_id,)).fetchone()
    return str(row[0]) if row else str(source_id)


def load_credential_row(source_id: UUID) -> SealedCredentialRow | None:
    """The encrypted credential for a source, still sealed.

    Returns the ciphertext untouched. Decryption happens in
    ``credentials.py``, which owns the key — keeping the read here and the
    open there means this module never has to be audited for key handling.

    ``None`` means nothing is stored, which is a normal state for a synthetic
    source and an error for every other kind.
    """
    with connect() as conn:
        row = conn.execute(
            """
            SELECT source_id, method, public_values, ciphertext, iv, auth_tag,
                   key_version, expires_at, scope
              FROM source_credentials
             WHERE source_id = %s
            """,
            (source_id,),
        ).fetchone()

    if row is None:
        return None

    return SealedCredentialRow(
        source_id=row[0],
        method=row[1],
        public_values=row[2] or {},
        ciphertext=row[3],
        iv=row[4],
        auth_tag=row[5],
        key_version=row[6],
        expires_at=row[7],
        scope=row[8],
    )


def read_run_status(run_id: UUID) -> tuple[RunStatus, RunStats, str | None] | None:
    """The run row as the console's status poll needs it."""
    with connect() as conn:
        row = conn.execute(
            "SELECT status, stats, error FROM runs WHERE id = %s", (run_id,)
        ).fetchone()

    if row is None:
        return None

    stats = RunStats.model_validate(row[1]) if isinstance(row[1], dict) else RunStats()
    return (row[0], stats, row[2])


# ── Writes (engine-owned tables) ─────────────────────────────────────────────


def write_entities(run_id: UUID, entities: list[CanonicalEntity]) -> None:
    """Insert this run's normalized records.

    Ids are derived from (run, source, type, external id) rather than left to
    the column default, because ``matches`` has to reference them and the
    matcher computed the same ids in memory without a round trip. Re-deriving
    them here rather than passing them in keeps ``normalize`` free of database
    concerns.
    """
    rows = [
        (
            entity_uuid(entity, run_id),
            run_id,
            UUID(entity.source_id),
            entity.external_id,
            entity.entity_type,
            Jsonb(
                {
                    "name": entity.name,
                    "normalizedName": entity.normalized_name,
                    "attributes": entity.attributes,
                }
            ),
            entity.parent_external_id,
            _timestamp(entity.last_modified_at),
        )
        for entity in entities
    ]

    _insert_many(
        """
        INSERT INTO entities
            (id, run_id, source_id, external_id, entity_type, fields,
             parent_external_id, last_modified_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        rows,
    )


def write_matches(run_id: UUID, matches: list[Match]) -> None:
    rows = [
        (
            match.id,
            run_id,
            match.entity_a_id,
            match.entity_b_id,
            match.confidence,
            match.method,
            Jsonb(match.signals.model_dump(by_alias=True)),
        )
        for match in matches
        if match.id is not None
    ]

    _insert_many(
        """
        INSERT INTO matches (id, run_id, entity_a_id, entity_b_id, confidence, method, signals)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        rows,
    )


def write_conflicts(run_id: UUID, conflicts: list[Conflict]) -> None:
    rows = [
        (
            conflict.id,
            run_id,
            conflict.match_id,
            conflict.field,
            conflict.value_a,
            conflict.value_b,
            conflict.conflict_class,
            conflict.severity,
            conflict.detected_by,
        )
        for conflict in conflicts
        if conflict.id is not None
    ]

    _insert_many(
        """
        INSERT INTO conflicts
            (id, run_id, match_id, field, value_a, value_b, conflict_class,
             severity, detected_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        rows,
    )


def write_resolutions(resolutions: list[Resolution]) -> None:
    """Proposals only. Human review columns are the web layer's to write.

    ``reviewed_by``, ``override_value`` and ``reviewed_at`` are deliberately
    absent from this statement: they are the record of what a person decided,
    and the engine has no business having an opinion about them.
    """
    rows = [
        (
            resolution.conflict_id,
            resolution.proposed_value,
            resolution.rationale,
            resolution.applied_rule_id,
            resolution.confidence,
            resolution.status,
        )
        for resolution in resolutions
    ]

    _insert_many(
        """
        INSERT INTO resolutions
            (conflict_id, proposed_value, rationale, applied_rule_id, confidence, status)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        rows,
    )


def update_run_status(
    run_id: UUID,
    status: RunStatus,
    *,
    stats: RunStats | None = None,
    error: str | None = None,
) -> None:
    """Status, stats and error only. Never the source or ruleset columns.

    ``finished_at`` is stamped exactly when the status becomes terminal, so the
    console can show a duration without inferring one from row timestamps.
    """
    terminal = status in ("complete", "failed")

    with connect() as conn:
        conn.execute(
            """
            UPDATE runs
               SET status      = %s,
                   stats       = COALESCE(%s, stats),
                   error       = %s,
                   finished_at = CASE WHEN %s THEN now() ELSE finished_at END
             WHERE id = %s
            """,
            (
                status,
                Jsonb(stats.model_dump(by_alias=True)) if stats is not None else None,
                error,
                terminal,
                run_id,
            ),
        )


def append_audit(
    run_id: UUID,
    action: AuditAction,
    *,
    actor: str,
    detail: dict[str, object],
    resolution_id: UUID | None = None,
) -> None:
    """Append-only. Never updated, never deleted."""
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO audit_log (run_id, resolution_id, action, actor, detail)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (run_id, resolution_id, action, actor, Jsonb(detail)),
        )


def append_audit_many(
    run_id: UUID,
    entries: list[tuple[AuditAction, str, dict[str, object], UUID | None]],
) -> None:
    """Batched append. Same table, same guarantees, one round trip per batch.

    A run producing several hundred decisions would otherwise open several
    hundred connections to write its own history — the audit trail is
    append-only, not append-slowly.
    """
    rows = [
        (run_id, resolution_id, action, actor, Jsonb(detail))
        for action, actor, detail, resolution_id in entries
    ]

    _insert_many(
        """
        INSERT INTO audit_log (run_id, resolution_id, action, actor, detail)
        VALUES (%s, %s, %s, %s, %s)
        """,
        rows,
    )


def resolution_ids_for_run(run_id: UUID) -> dict[UUID, UUID]:
    """conflict id → resolution id, for audit rows written after the proposals.

    ``resolutions.id`` is generated by the database, so the only way to point an
    audit entry at one is to read it back. Done in a single query rather than
    per row: a run with a thousand escalations would otherwise be a thousand
    round trips to write its own audit trail.
    """
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT r.conflict_id, r.id
              FROM resolutions r
              JOIN conflicts c ON c.id = r.conflict_id
             WHERE c.run_id = %s
            """,
            (run_id,),
        ).fetchall()

    return {row[0]: row[1] for row in rows}


# ── internals ────────────────────────────────────────────────────────────────


def _insert_many(statement: str, rows: list[tuple[Any, ...]]) -> None:
    """Batched ``executemany``, one transaction for the whole set.

    All-or-nothing on purpose: a partially written entity table would leave a
    run whose matches reference rows that do not exist, and the foreign keys
    would then fail in a way that reads like a matcher bug.
    """
    if not rows:
        return

    with connect() as conn, conn.cursor() as cursor:
        for start in range(0, len(rows), _BATCH):
            cursor.executemany(statement, rows[start : start + _BATCH])


def _timestamp(value: str | None) -> datetime | None:
    """ISO 8601 → aware datetime, or None.

    Naive input is read as UTC rather than rejected: a source system that omits
    an offset is stating a wall-clock time, and guessing the server's local zone
    would make ``most_recent`` depend on where the engine happens to run.
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
