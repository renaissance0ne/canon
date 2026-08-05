"""Candidate generation, then matching.

Blocking exists so the pipeline is O(n·k), not O(n²). NEVER compare all pairs —
that is the difference between a 500-account demo and a 50,000-account org.

Order matters: exact key first (external id, then domain, then normalized
name), and only what is left over goes through embeddings.
"""

from __future__ import annotations

from uuid import UUID

from pipeline.schema import CanonicalEntity, Match, MatchSignals

#: Neighbours retrieved per unmatched entity from the FAISS index.
TOP_K = 10

#: Below this, a candidate pair is not worth scoring.
MIN_MATCH_CONFIDENCE = 0.50


def block(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
    *,
    top_k: int = TOP_K,
) -> list[tuple[CanonicalEntity, CanonicalEntity]]:
    """Candidate pairs only — exact key first, then embedding top-k."""
    raise NotImplementedError("Phase 2 — see AGENTS.md § Feature List")


def score(a: CanonicalEntity, b: CanonicalEntity) -> MatchSignals:
    """RapidFuzz ratio, cosine similarity and exact-key agreement."""
    raise NotImplementedError("Phase 2 — see AGENTS.md § Feature List")


def combine(signals: MatchSignals) -> float:
    """Signals → one confidence in 0..1. The weights are swept by eval/."""
    raise NotImplementedError("Phase 2 — see AGENTS.md § Feature List")


def match(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
    *,
    run_id: UUID,
) -> list[Match]:
    """Full blocking + scoring pass. Pure: writes nothing."""
    raise NotImplementedError("Phase 2 — see AGENTS.md § Feature List")
