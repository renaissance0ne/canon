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

    sources       WEB ONLY — the engine must NEVER write this
    rulesets      WEB ONLY — the engine must NEVER write this

Violating that split makes runs non-reproducible. Drizzle owns the schema;
nothing here migrates it.
"""

from __future__ import annotations

from uuid import UUID

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

# ── Reads (web-owned config — read freely, write never) ──────────────────────


def load_run_config(run_id: UUID) -> tuple[UUID, UUID, UUID]:
    """``run_id`` → (source_a_id, source_b_id, ruleset_id).

    Everything a run needs is read from Postgres, not from the request body:
    two sources of truth for what a run executed would break reproducibility.
    """
    raise NotImplementedError("Phase 1 — see AGENTS.md § How a Reconciliation Run Works")


def load_ruleset(ruleset_id: UUID) -> list[SurvivorshipRule]:
    """Read a versioned ruleset. Never mutate it — past runs must still reproduce."""
    raise NotImplementedError("Phase 1 — see AGENTS.md § How a Reconciliation Run Works")


# ── Writes (engine-owned tables) ─────────────────────────────────────────────


def write_entities(run_id: UUID, entities: list[CanonicalEntity]) -> None:
    raise NotImplementedError("Phase 2 — see AGENTS.md § Table Ownership")


def write_matches(run_id: UUID, matches: list[Match]) -> None:
    raise NotImplementedError("Phase 2 — see AGENTS.md § Table Ownership")


def write_conflicts(run_id: UUID, conflicts: list[Conflict]) -> None:
    raise NotImplementedError("Phase 2 — see AGENTS.md § Table Ownership")


def write_resolutions(resolutions: list[Resolution]) -> None:
    """Proposals only. Human review columns are the web layer's to write."""
    raise NotImplementedError("Phase 3 — see AGENTS.md § Table Ownership")


def update_run_status(
    run_id: UUID,
    status: RunStatus,
    *,
    stats: RunStats | None = None,
    error: str | None = None,
) -> None:
    """Status, stats and error only. Never the source or ruleset columns."""
    raise NotImplementedError("Phase 1 — see AGENTS.md § Table Ownership")


def append_audit(
    run_id: UUID,
    action: AuditAction,
    *,
    actor: str,
    detail: dict[str, object],
    resolution_id: UUID | None = None,
) -> None:
    """Append-only. Never updated, never deleted."""
    raise NotImplementedError("Phase 1 — see AGENTS.md § Table Ownership")
