"""Conflict detection and severity scoring.

Pure: ``detect(matches) -> conflicts``. No DB writes here — main.py owns those.

Severity is a defined integer the auto-apply gate reads, and it has to be
justifiable in the paper. It is set here and nowhere else.
"""

from __future__ import annotations

from uuid import UUID

from pipeline.schema import CanonicalEntity, Conflict, ConflictClass, Match, Severity

#: Fields whose disagreement changes the SHAPE of the hierarchy. Rollups break.
STRUCTURAL_FIELDS: frozenset[str] = frozenset({"parentExternalId"})

#: Fields that change who owns or is credited for something.
OWNERSHIP_FIELDS: frozenset[str] = frozenset({"territory", "roleName", "ownerId"})


def classify(field: str, value_a: str, value_b: str) -> tuple[ConflictClass, Severity]:
    """One field disagreement → its class and severity.

    * ``parentExternalId`` differs → structural, 4
    * territory / role / owner differs → attribute, 3
    * any other field differs → attribute, 2
    * values fold to the same normalized form → cosmetic, 1
    """
    raise NotImplementedError("Phase 2 — see AGENTS.md § Severity Model")


def severity_for_orphan(*, has_children: bool) -> Severity:
    """4 when the entity has children, 3 when it does not."""
    return 4 if has_children else 3


def detect(
    matches: list[Match],
    entities: dict[UUID, CanonicalEntity],
    *,
    run_id: UUID,
) -> list[Conflict]:
    """Field-by-field diff across every match.

    Unmatched entities on either side are recorded as ``orphan`` conflicts; two
    records on one side matching one on the other are ``duplicate``, always
    severity 4 — a duplicate silently double-counts.
    """
    raise NotImplementedError("Phase 2 — see AGENTS.md § Feature List")
