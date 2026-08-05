"""Synthetic data and ground truth.

Built in Phase 1, BEFORE the engine — you cannot develop a detector without
knowing what it is supposed to detect.

One seed produces three artifacts:

1. the canonical org — a synthetic company hierarchy with realistic shape, not
   uniform: a few large subtrees, many small ones, some depth-4 chains;
2. side A (the "CRM" view) and side B (the "warehouse" view);
3. the ground-truth manifest — every injected divergence, with the resolution
   that is actually correct.

Usage::

    uv run python -m eval.generate --seed 42 --accounts 500 --out ./data/run42
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pipeline.schema import ConflictClass


@dataclass(frozen=True)
class InjectionRates:
    """Default divergence rates. Every injection type has a matching detector.

    The last row matters most. A generator that only produces resolvable
    conflicts makes the system look perfect and the paper look naive —
    ``ambiguous`` cases exist so the system can be scored on whether it
    ESCALATES them rather than guessing.
    """

    reparent: float = 0.05
    stale_attribute: float = 0.08
    name_variant: float = 0.12
    missing_record: float = 0.03
    duplicate_record: float = 0.02
    ambiguous: float = 0.02


@dataclass(frozen=True)
class ManifestEntry:
    """One injected divergence, and the answer it is scored against."""

    entity_id: str
    field: str
    true_value: str | None
    side_a_value: str | None
    side_b_value: str | None
    conflict_class: ConflictClass
    #: The correct outcome — which may be the literal string "escalate".
    expected_resolution: str


def generate(
    *,
    seed: int,
    accounts: int,
    out_dir: Path,
    rates: InjectionRates | None = None,
) -> list[ManifestEntry]:
    """Write side A, side B and manifest.json into ``out_dir``.

    Seeded so runs are reproducible; commit the seed used for reported results.
    """
    raise NotImplementedError("Phase 1 — see AGENTS.md § Synthetic Data & Ground Truth")
