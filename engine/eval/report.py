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

_SYSTEM_LABELS: dict[str, str] = {
    "baseline_exact": "baseline_exact",
    "baseline_rules": "baseline_rules",
    "canon_full": "canon_full",
}


def write_results_table(
    results: dict[System, Metrics], out_dir: Path = DEFAULT_OUT_DIR
) -> Path:
    """Markdown table, all three systems side by side."""
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "results.md"
    path.write_text(_results_markdown(results), encoding="utf-8")
    return path


def write_report(
    *,
    seed: int,
    data_dir: Path,
    runs: dict[System, Metrics],
    ablations: dict[str, Metrics],
    sweep: dict[float, Metrics],
    invented_values: int,
    provider: str = "claude",
    model: str = "",
    out_dir: Path = DEFAULT_OUT_DIR,
) -> Path:
    """The whole results chapter: tables, ablations, figures.

    The seed is written into the document rather than kept in a shell history.
    Reported numbers cite a seed, and a results file that does not name the one
    it came from cannot be reproduced by the person reading it. The same
    argument applies to the model: ``canon_full`` is a different system under
    Claude than under Gemini, and a results table that does not say which one
    answered is not reproducible either.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    sections = [
        "# Canon — evaluation results",
        "",
        f"Seed `{seed}` · dataset `{data_dir}`",
        f"Resolution model `{model or provider}` (`{provider}`)",
        "",
        *_degradation_warning(runs),
        "Regenerate with:",
        "",
        "```bash",
        f"uv run python -m eval.generate --seed {seed} --accounts 500 --out {data_dir}",
        f"uv run python -m eval.harness --seed {seed} --provider {provider} "
        f"--systems all --report",
        "```",
        "",
        _results_markdown(runs),
    ]

    if ablations:
        sections += [
            "",
            "## Ablation 1 — without the `validate` node",
            "",
            "`validate` rejects any proposed value that is not one of the two observed",
            "values or a legal normalization of one. Removing it changes nothing about",
            "what the model is asked; it changes only whether the answer is checked.",
            "",
            f"**Invented values produced with the node removed: {invented_values}.**",
            "With the node in place the count is zero by construction.",
            "",
            _table(
                ["metric", *ablations],
                [
                    [name, *(f"{getattr(m, key):.3f}" for m in ablations.values())]
                    for name, key in _METRIC_ROWS
                ],
            ),
        ]

    if sweep:
        figure = plot_threshold_sweep(sweep, out_dir)
        sections += [
            "",
            "## Ablation 2 — auto-apply threshold sweep",
            "",
            "The precision/recall tradeoff curve for the whole system. Every point",
            "reuses the same proposals — moving the gate re-derives which side of it",
            "each answer falls on, so the sweep costs no additional tokens.",
            "",
            f"![Auto-apply threshold sweep]({figure.name})",
            "",
            _table(
                ["threshold", "false auto-apply", "escalation rate", "resolution accuracy"],
                [
                    [
                        f"{threshold:.2f}",
                        f"{metrics.false_auto_apply_rate:.3f}",
                        f"{metrics.escalation_rate:.3f}",
                        f"{metrics.resolution_accuracy:.3f}",
                    ]
                    for threshold, metrics in sorted(sweep.items())
                ],
            ),
        ]

    if runs:
        detection_figure = plot_detection(runs, out_dir)
        sections += [
            "",
            "## Detection quality",
            "",
            f"![Detection precision, recall and F1]({detection_figure.name})",
        ]

    path = out_dir / "results.md"
    path.write_text("\n".join(sections) + "\n", encoding="utf-8")
    return path


def _degradation_warning(results: dict[System, Metrics]) -> list[str]:
    """Say loudly when a run's agent never actually ran.

    A results file is the artifact somebody quotes months later, by which point
    nobody remembers that the key had expired. If the model failed, the numbers
    under `canon_full` are the deterministic pipeline's and the document has to
    say so before anyone reads the table.
    """
    failed = {
        name: metrics for name, metrics in results.items() if metrics.model_errors
    }
    if not failed:
        return []

    lines = [
        "> **These numbers are not the agent's.**",
        ">",
    ]
    for name, metrics in failed.items():
        lines += [
            f"> `{name}` issued {metrics.model_errors} model calls and every one "
            f"failed, so those conflicts escalated on the failure path rather than "
            f"being proposed. Its column below is the deterministic pipeline.",
            ">",
            f"> First error: `{metrics.first_error}`",
            ">",
        ]
    lines += [
        "> Fix the cause and re-run before citing anything under `canon_full`.",
        "",
    ]
    return lines


#: (row label, Metrics attribute). Ordered so the operationally important
#: numbers — false auto-apply and escalation — are not buried under detection.
_METRIC_ROWS: tuple[tuple[str, str], ...] = (
    ("precision", "precision"),
    ("recall", "recall"),
    ("F1", "f1"),
    ("resolution accuracy", "resolution_accuracy"),
    ("**false auto-apply rate**", "false_auto_apply_rate"),
    ("escalation rate", "escalation_rate"),
    ("escalation precision", "escalation_precision"),
)


def _results_markdown(results: dict[System, Metrics]) -> str:
    if not results:
        return "_No systems were run._"

    names = list(results)
    header = ["metric", *(_SYSTEM_LABELS.get(str(name), str(name)) for name in names)]

    rows = [
        [label, *(f"{getattr(results[name], key):.3f}" for name in names)]
        for label, key in _METRIC_ROWS
    ]
    rows += [
        ["conflicts detected", *(str(results[name].detected) for name in names)],
        ["true positives", *(str(results[name].true_positives) for name in names)],
        ["false positives", *(str(results[name].false_positives) for name in names)],
        ["false negatives", *(str(results[name].false_negatives) for name in names)],
        ["auto-applied", *(str(results[name].auto_applied) for name in names)],
        ["escalated", *(str(results[name].escalated) for name in names)],
        ["model calls", *(str(results[name].model_calls) for name in names)],
        ["tokens", *(str(results[name].tokens_used) for name in names)],
        [
            "USD / 1k conflicts",
            *(f"{results[name].usd_per_1k_conflicts:.2f}" for name in names),
        ],
    ]

    return "\n".join(
        [
            "## Systems",
            "",
            "`baseline_exact` is the floor: exact matching, no normalization.",
            "`baseline_rules` shares the entire detection path with `canon_full` and",
            "differs only in that no model is called — whatever separates the two is",
            "attributable to the agent.",
            "",
            _table(header, rows),
        ]
    )


def _table(header: list[str], rows: list[list[str]]) -> str:
    lines = [
        "| " + " | ".join(header) + " |",
        "|" + "|".join("---" for _ in header) + "|",
    ]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(lines)


def plot_threshold_sweep(
    sweep: dict[float, Metrics],
    out_dir: Path = DEFAULT_OUT_DIR,
) -> Path:
    """False auto-apply rate against escalation rate. Grayscale, dashed series."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out_dir.mkdir(parents=True, exist_ok=True)
    thresholds = sorted(sweep)

    figure, axes = plt.subplots(figsize=(6.0, 3.6), dpi=200)

    series = (
        ("false auto-apply rate", [sweep[t].false_auto_apply_rate for t in thresholds]),
        ("escalation rate", [sweep[t].escalation_rate for t in thresholds]),
        ("resolution accuracy", [sweep[t].resolution_accuracy for t in thresholds]),
    )

    for index, (label, values) in enumerate(series):
        axes.plot(
            thresholds,
            values,
            label=label,
            color=FIGURE_GRAYS[index],
            linestyle=FIGURE_DASHES[index],
            linewidth=1.4,
            marker="o",
            markersize=3,
        )

    axes.set_xlabel("auto-apply confidence threshold")
    axes.set_ylabel("rate")
    axes.set_ylim(-0.02, 1.02)
    _style(axes)
    axes.legend(frameon=False, fontsize=8, loc="best")

    path = out_dir / "threshold-sweep.png"
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)
    return path


def plot_detection(
    results: dict[System, Metrics],
    out_dir: Path = DEFAULT_OUT_DIR,
) -> Path:
    """Precision, recall and F1 per system, as grouped bars."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out_dir.mkdir(parents=True, exist_ok=True)
    names = list(results)

    figure, axes = plt.subplots(figsize=(6.0, 3.6), dpi=200)
    width = 0.26

    for index, (label, key) in enumerate(
        (("precision", "precision"), ("recall", "recall"), ("F1", "f1"))
    ):
        positions = [position + index * width for position in range(len(names))]
        axes.bar(
            positions,
            [getattr(results[name], key) for name in names],
            width=width,
            label=label,
            color=FIGURE_GRAYS[index],
            edgecolor="#18181B",
            linewidth=0.6,
        )

    axes.set_xticks([position + width for position in range(len(names))])
    axes.set_xticklabels([_SYSTEM_LABELS.get(str(name), str(name)) for name in names])
    axes.set_ylabel("score")
    axes.set_ylim(0, 1.02)
    _style(axes)
    axes.legend(frameon=False, fontsize=8, loc="best")

    path = out_dir / "detection.png"
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)
    return path


def _style(axes: object) -> None:
    """Hairlines, no chartjunk — the console's rules, applied to figures."""
    from matplotlib.axes import Axes

    assert isinstance(axes, Axes)
    axes.spines["top"].set_visible(False)
    axes.spines["right"].set_visible(False)
    for spine in ("left", "bottom"):
        axes.spines[spine].set_color("#D4D4D8")
        axes.spines[spine].set_linewidth(0.8)
    axes.tick_params(colors="#52525B", labelsize=8, length=3, width=0.8)
    axes.grid(axis="y", color="#E4E4E7", linewidth=0.6)
    axes.set_axisbelow(True)
