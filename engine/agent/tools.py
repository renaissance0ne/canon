"""Tools exposed to the resolution agent.

Read-only by construction. The agent inspects evidence; it never mutates a
source system and never writes Canon's own tables — main.py and db.py do that,
after ``validate`` has passed.
"""

from __future__ import annotations

from pipeline.schema import CanonicalEntity


def get_entity_history(external_id: str, source_id: str) -> list[CanonicalEntity]:
    """Prior versions of an entity within this run's extract. Read-only."""
    raise NotImplementedError("Phase 3 — see AGENTS.md § Feature List")


def get_children(external_id: str, source_id: str) -> list[CanonicalEntity]:
    """Direct children — what a re-parent would actually move. Read-only."""
    raise NotImplementedError("Phase 3 — see AGENTS.md § Feature List")
