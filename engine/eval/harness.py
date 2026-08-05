"""The evaluation harness — not an afterthought bolted on at the end.

Runs all three systems against generated data with a known manifest and
produces the results table. Every change to detection or resolution logic must
be re-runnable through here to produce updated numbers.

Usage::

    uv run python -m eval.harness --seed 42 --systems all --report
    uv run python -m eval.harness --seed 42 --quick
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from eval.generate import ManifestEntry

System = Literal["baseline_exact", "baseline_rules", "canon_full"]

ALL_SYSTEMS: tuple[System, ...] = ("baseline_exact", "baseline_rules", "canon_full")


@dataclass(frozen=True)
class Metrics:
    """Reported per system, side by side, always."""

    #: Conflict detection against the manifest.
    precision: float
    recall: float
    f1: float
    #: Of conflicts resolved, the fraction matching expected_resolution.
    resolution_accuracy: float
    #: Of conflicts escalated, the fraction genuinely ambiguous in the manifest.
    #: Escalating easy conflicts is a cost, not a virtue.
    escalation_precision: float
    #: Auto-applied resolutions that were wrong. The metric that matters most
    #: operationally — report it prominently, never bury it.
    false_auto_apply_rate: float
    #: Escalation rate is a HEADLINE metric, not a failure count.
    escalation_rate: float
    tokens_used: int
    usd_per_1k_conflicts: float


def run_system(system: System, manifest: list[ManifestEntry], data_dir: Path) -> Metrics:
    """Score one system against the ground-truth manifest."""
    raise NotImplementedError("Phase 2/6 — see AGENTS.md § Evaluation Harness")


def ablate_without_validate(manifest: list[ManifestEntry], data_dir: Path) -> Metrics:
    """Required ablation 1: does removing ``validate`` produce invented values?

    Quantify it. This is the empirical case for the node being non-optional.
    """
    raise NotImplementedError("Phase 6 — see AGENTS.md § Evaluation Harness")


def sweep_auto_apply_threshold(
    manifest: list[ManifestEntry],
    data_dir: Path,
    *,
    start: float = 0.50,
    stop: float = 0.95,
    step: float = 0.05,
) -> dict[float, Metrics]:
    """Required ablation 2: false auto-apply rate against escalation rate.

    This is the precision/recall tradeoff curve for the whole system, and the
    strongest single figure in the paper.
    """
    raise NotImplementedError("Phase 6 — see AGENTS.md § Evaluation Harness")
