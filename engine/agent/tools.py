"""Tools exposed to the resolution agent.

Read-only by construction. The agent inspects evidence; it never mutates a
source system and never writes Canon's own tables — main.py and db.py do that,
after ``validate`` has passed.

Both functions read ``entities``, which is engine-owned and already written by
the time resolution runs. Neither takes a credential and neither opens a
connector: by the resolve stage the source systems have already been read, and
going back to them would make a resolution depend on the state of an org at a
different instant than the conflict it is resolving.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pipeline.schema import CanonicalEntity

#: How far back ``get_entity_history`` looks. A reviewer deciding whether a
#: field flip is routine wants the last few runs, not the last year — and an
#: unbounded scan of a table with one row per entity per run is the kind of
#: query that is fine in development and pages someone in production.
HISTORY_LIMIT = 5


def get_entity_history(
    external_id: str,
    source_id: str,
    *,
    limit: int = HISTORY_LIMIT,
) -> list[CanonicalEntity]:
    """Prior versions of an entity within this run's extract. Read-only.

    "Prior version" means the same record as seen by *earlier completed runs* —
    a single run extracts an entity once, so there is no history inside one.
    Ordered newest first.

    This is the evidence behind "has this field flipped before?", which is the
    question that separates a genuine correction from a system that has been
    fighting another system for weeks.
    """
    from db import connect

    with connect() as conn:
        rows = conn.execute(
            """
            SELECT e.external_id, e.entity_type, e.fields, e.parent_external_id,
                   e.last_modified_at, e.source_id
              FROM entities e
              JOIN runs r ON r.id = e.run_id
             WHERE e.external_id = %s
               AND e.source_id   = %s
               AND r.status      = 'complete'
             ORDER BY r.started_at DESC
             LIMIT %s
            """,
            (external_id, UUID(source_id), limit),
        ).fetchall()

    return [_entity(row) for row in rows]


def get_children(
    external_id: str,
    source_id: str,
    *,
    run_id: UUID,
) -> list[CanonicalEntity]:
    """Direct children — what a re-parent would actually move. Read-only.

    Scoped to one run and one source because that is the hierarchy the conflict
    is about; borrowing the other side's children would answer a question nobody
    asked. This is what makes a structural conflict's blast radius concrete: a
    re-parent of a node with 400 descendants is a different decision from a
    re-parent of a leaf, and the severity model only distinguishes "has children"
    from "does not".
    """
    from db import connect

    with connect() as conn:
        rows = conn.execute(
            """
            SELECT external_id, entity_type, fields, parent_external_id,
                   last_modified_at, source_id
              FROM entities
             WHERE run_id             = %s
               AND source_id          = %s
               AND parent_external_id = %s
             ORDER BY external_id
            """,
            (run_id, UUID(source_id), external_id),
        ).fetchall()

    return [_entity(row) for row in rows]


def _entity(row: tuple[Any, ...]) -> CanonicalEntity:
    """One ``entities`` row → the canonical shape the rest of the engine speaks.

    ``fields`` is the jsonb half of the row; the promoted columns are the half
    matching and survivorship read directly. Rebuilding the model here rather
    than returning a raw row keeps the agent's evidence in the same type as the
    pipeline's own output.
    """
    fields = row[2] if isinstance(row[2], dict) else {}
    modified = row[4]

    return CanonicalEntity(
        external_id=row[0],
        entity_type=row[1],
        name=fields.get("name", ""),
        normalized_name=fields.get("normalizedName", ""),
        parent_external_id=row[3],
        attributes=fields.get("attributes", {}),
        last_modified_at=modified.isoformat() if modified is not None else None,
        source_id=str(row[5]),
    )
