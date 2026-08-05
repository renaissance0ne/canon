"""Raw source records → CanonicalEntity.

A pure function: no DB writes, no API calls. That is what lets the evaluation
harness run the identical code path as production.

Folding is RECORDED, NOT DESTRUCTIVE — case, whitespace, punctuation and known
legal suffixes ("Inc.", "Pvt Ltd", "GmbH") are folded into
``normalized_name``, and ``name`` keeps what the source actually said. A
cosmetic conflict is only detectable if both survive.
"""

from __future__ import annotations

from collections.abc import Iterable

from connectors.base import RawRecord
from pipeline.schema import CanonicalEntity, EntityType

#: Folded off the tail of a name before comparison. Recorded, never discarded.
LEGAL_SUFFIXES: tuple[str, ...] = (
    "inc",
    "llc",
    "ltd",
    "limited",
    "corp",
    "corporation",
    "co",
    "gmbh",
    "pvt",
    "pvt ltd",
    "plc",
    "sa",
    "bv",
    "ag",
)


def fold_name(name: str) -> str:
    """Case, whitespace, punctuation and legal-suffix folding.

    Deterministic and total: the same input always folds the same way, in every
    layer, or matching stops being reproducible.
    """
    raise NotImplementedError("Phase 2 — see AGENTS.md § Feature List")


def normalize(
    records: Iterable[RawRecord],
    *,
    entity_type: EntityType,
    source_id: str,
) -> list[CanonicalEntity]:
    """Normalize one source's records of one entity type."""
    raise NotImplementedError("Phase 2 — see AGENTS.md § Feature List")
