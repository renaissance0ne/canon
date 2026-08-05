"""Results tables and figures, written into docs/results/.

Grayscale — the same constraint as the console, and it makes the figures
print-safe for the paper.
"""

from __future__ import annotations

from pathlib import Path

from eval.harness import Metrics, System

#: Up to four series, distinguished by DASH PATTERN as well as value. Never more
#: than four in one figure — if you need five, you need two figures.
FIGURE_GRAYS: tuple[str, ...] = ("#18181B", "#52525B", "#A1A1AA", "#E4E4E7")
FIGURE_DASHES: tuple[str, ...] = ("-", "--", "-.", ":")

DEFAULT_OUT_DIR = Path("../docs/results")


def write_results_table(results: dict[System, Metrics], out_dir: Path = DEFAULT_OUT_DIR) -> Path:
    """Markdown table, all three systems side by side."""
    raise NotImplementedError("Phase 6 — see AGENTS.md § Evaluation Harness")


def plot_threshold_sweep(
    sweep: dict[float, Metrics],
    out_dir: Path = DEFAULT_OUT_DIR,
) -> Path:
    """False auto-apply rate against escalation rate. Grayscale, dashed series."""
    raise NotImplementedError("Phase 6 — see AGENTS.md § Evaluation Harness")
