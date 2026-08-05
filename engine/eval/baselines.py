"""The two baselines.

Built in Phase 2, NOT at the end, so every subsequent change to detection or
resolution is measured against them from the day it lands.

``baseline_rules`` is the one that matters: it is fuzzy matching plus the
deterministic ruleset with no model at all. If the full pipeline cannot beat it,
the agent is not earning its cost, and that is a finding worth reporting rather
than hiding.
"""

from __future__ import annotations

from pipeline.schema import CanonicalEntity, Conflict, Resolution, SurvivorshipRule


def baseline_exact(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
) -> list[Conflict]:
    """The floor. Exact string match only; flags any inequality as a conflict."""
    raise NotImplementedError("Phase 2 — see AGENTS.md § Evaluation Harness")


def baseline_rules(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
    rules: list[SurvivorshipRule],
) -> tuple[list[Conflict], list[Resolution]]:
    """Fuzzy matching plus the deterministic ruleset. No model."""
    raise NotImplementedError("Phase 2 — see AGENTS.md § Evaluation Harness")
