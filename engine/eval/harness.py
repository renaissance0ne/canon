"""The evaluation harness — not an afterthought bolted on at the end.

Runs all three systems against generated data with a known manifest and
produces the results table. Every change to the reconciliation or resolution
logic must be re-runnable through here to produce updated numbers.

Usage::

    uv run python -m eval.harness --seed 42 --systems all --report
    uv run python -m eval.harness --seed 42 --quick
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from uuid import UUID

from dotenv import load_dotenv

from agent.graph import (
    AUTO_APPLY_MAX_SEVERITY,
    ModelProposer,
    ModelUsage,
    Proposal,
    Proposer,
    build_proposer,
    missing_key_message,
    resolve,
)
from agent.prompts import resolution_model
from connectors.synthetic import SyntheticConnector
from eval.baselines import EVAL_RUN_ID, baseline_exact_detailed, baseline_rules_detailed
from eval.generate import ENTITY_FILES, ESCALATE, ManifestEntry, load_manifest
from pipeline.blocking import match
from pipeline.detect import ConflictOrigin, Detection, detect_detailed
from pipeline.normalize import entity_uuid, normalize
from pipeline.schema import (
    CanonicalEntity,
    Conflict,
    EntityType,
    ModelProvider,
    Resolution,
    SurvivorshipRule,
)

System = Literal["baseline_exact", "baseline_rules", "canon_full"]

ALL_SYSTEMS: tuple[System, ...] = ("baseline_exact", "baseline_rules", "canon_full")

#: Source identifiers for the two synthetic sides. Short and readable because
#: they end up in rationales a human reads; in production these are the uuids of
#: rows in `sources`.
SOURCE_A = "crm"
SOURCE_B = "warehouse"

#: What the console would call these two sources.
LABELS: tuple[str, str] = ("Salesforce (CRM)", "Databricks GTM")

@dataclass(frozen=True)
class RateCard:
    """USD per million tokens for one provider's resolution model, at list price.

    List rather than promotional or free-tier: both providers discount, and a
    cost column computed from a promotion is a number that stops being true
    without anything in the repository changing. A reader can apply their own
    discount to a list figure; they cannot recover list from a discounted one.
    """

    input: float
    output: float
    cache_read: float
    cache_write: float


#: The ruleset block is the cache prefix, so on a run of any size almost all of
#: each call's input is a cache read — which is why the cache rates, not the
#: input rate, dominate the cost column.
RATE_CARDS: dict[ModelProvider, RateCard] = {
    # claude-sonnet-5. Cache reads are ~0.1x input, writes ~1.25x.
    "claude": RateCard(input=3.00, output=15.00, cache_read=0.30, cache_write=3.75),
    # gemini-3.5-flash-lite, matching MODEL_RESOLUTION_GEMINI. Caching is
    # implicit: cached input is billed at a fraction of input and there is no
    # write charge, so `cache_write` is 0 rather than unset.
    #
    # CONFIRM THESE AGAINST CURRENT PRICING BEFORE PUBLISHING A COST COLUMN,
    # and re-check them if CANON_GEMINI_MODEL moves off Flash-Lite — this card
    # is per-PROVIDER, not per-model, so an override silently prices the run on
    # the wrong tier. The Gemini Flash line reprices more often than Sonnet
    # does, and a stale figure here is a wrong number in a results table rather
    # than a stale comment.
    "gemini": RateCard(input=0.10, output=0.40, cache_read=0.025, cache_write=0.00),
}

#: The policy the reported numbers were produced under.
#:
#: It deliberately leaves the severity-2 attribute fields (`segment`,
#: `industry`, `isActive`, `region`) and record-level conflicts uncovered. Those
#: are the only conflicts the auto-apply gate can ever pass, so leaving them to
#: the agent is what makes `baseline_rules` and `canon_full` differ by the agent
#: and by nothing else. A blanket `*`/`*` rule would resolve everything
#: deterministically and make the comparison vacuous.
DEFAULT_RULESET: list[SurvivorshipRule] = [
    SurvivorshipRule(
        id="parent-most-recent",
        field="parentExternalId",
        entity_type="*",
        strategy="most_recent",
        description=(
            "Hierarchy edges follow the most recent edit. Territory and revenue "
            "rollups are computed from this edge, so a stale parent misattributes "
            "every child beneath it."
        ),
    ),
    SurvivorshipRule(
        id="name-most-recent",
        field="name",
        entity_type="*",
        strategy="most_recent",
        description="Display names follow the most recent edit; renames flow CRM-first.",
    ),
    SurvivorshipRule(
        id="territory-most-recent",
        field="territory",
        entity_type="*",
        strategy="most_recent",
        description=(
            "Territory assignment follows the most recent edit — reassignment happens "
            "in the CRM and reaches the warehouse only after the next load."
        ),
    ),
    SurvivorshipRule(
        id="role-most-recent",
        field="roleName",
        entity_type="user",
        strategy="most_recent",
        description="A user's role follows the most recent edit; promotions are entered once.",
    ),
    SurvivorshipRule(
        id="owner-most-recent",
        field="ownerId",
        entity_type="account",
        strategy="most_recent",
        description="Account ownership follows the most recent edit; it drives quota credit.",
    ),
]


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

    #: Counts behind the rates. Present so a reader can check the arithmetic
    #: rather than take a ratio on faith.
    detected: int = 0
    expected: int = 0
    true_positives: int = 0
    false_positives: int = 0
    false_negatives: int = 0
    auto_applied: int = 0
    escalated: int = 0
    false_auto_applies: int = 0
    model_calls: int = 0
    model_errors: int = 0
    #: Throttled-and-retried requests. Cost wall-clock, not correctness.
    model_rate_limited: int = 0
    first_error: str = ""


@dataclass
class SystemRun:
    """Everything one system produced, kept so ablations can reuse it."""

    system: System
    metrics: Metrics
    conflicts: list[Conflict] = field(default_factory=list)
    resolutions: list[Resolution] = field(default_factory=list)
    origins: dict[UUID, ConflictOrigin] = field(default_factory=dict)


# ── Loading ──────────────────────────────────────────────────────────────────


def load_sides(data_dir: Path) -> tuple[list[CanonicalEntity], list[CanonicalEntity]]:
    """Read both sides of a generated dataset through the real connector.

    Through ``SyntheticConnector`` and ``normalize`` rather than straight off
    disk, because the benchmark's numbers only transfer to production if the
    benchmark ran the production code path. A shortcut here would silently
    measure a pipeline nobody ships.
    """
    entity_types: list[EntityType] = list(ENTITY_FILES)

    sides: list[list[CanonicalEntity]] = []
    for side, source_id in (("a", SOURCE_A), ("b", SOURCE_B)):
        connector = SyntheticConnector(data_dir=data_dir, side=side)
        entities: list[CanonicalEntity] = []
        for entity_type in entity_types:
            entities.extend(
                normalize(
                    connector.extract(entity_type),
                    entity_type=entity_type,
                    source_id=source_id,
                )
            )
        sides.append(entities)

    return sides[0], sides[1]


class CachingProposer:
    """Memoizes proposals by conflict id.

    Two callers need the *same* proposals: ``canon_full`` and the validate-node
    ablation. Re-asking the model would pay twice and, worse, would let sampling
    variation contaminate an ablation whose entire purpose is to isolate one
    node. Caching makes the comparison exact.
    """

    def __init__(self, inner: Proposer) -> None:
        self._inner = inner
        self._cache: dict[UUID | None, Proposal | None] = {}

    def __call__(
        self,
        conflict: Conflict,
        origin: ConflictOrigin | None,
        labels: tuple[str, str],
    ) -> Proposal | None:
        key = conflict.id
        if key not in self._cache:
            self._cache[key] = self._inner(conflict, origin, labels)
        return self._cache[key]


# ── Running one system ───────────────────────────────────────────────────────


def run_system(
    system: System,
    manifest: list[ManifestEntry],
    data_dir: Path,
    *,
    rules: list[SurvivorshipRule] | None = None,
    proposer: Proposer | None = None,
    usage: ModelUsage | None = None,
) -> Metrics:
    """Score one system against the ground-truth manifest."""
    return execute(
        system, manifest, data_dir, rules=rules, proposer=proposer, usage=usage
    ).metrics


def execute(
    system: System,
    manifest: list[ManifestEntry],
    data_dir: Path,
    *,
    rules: list[SurvivorshipRule] | None = None,
    proposer: Proposer | None = None,
    usage: ModelUsage | None = None,
) -> SystemRun:
    """``run_system``, keeping the intermediate output for ablations."""
    rules = rules if rules is not None else DEFAULT_RULESET
    side_a, side_b = load_sides(data_dir)

    if system == "baseline_exact":
        detection = baseline_exact_detailed(side_a, side_b)
        #: The floor resolves nothing. It is a detector, and reporting it as if
        #: it had a resolution policy would flatter it.
        resolutions: list[Resolution] = []
    elif system == "baseline_rules":
        detection, resolutions = baseline_rules_detailed(side_a, side_b, rules)
    else:
        detection = _redetect(side_a, side_b)
        resolutions = resolve(
            detection.conflicts,
            rules,
            origins=detection.origins,
            proposer=proposer,
            labels=LABELS,
        )

    metrics = score_run(
        detection,
        resolutions,
        manifest,
        usage=usage,
    )
    return SystemRun(
        system=system,
        metrics=metrics,
        conflicts=detection.conflicts,
        resolutions=resolutions,
        origins=dict(detection.origins),
    )


def _redetect(
    side_a: list[CanonicalEntity], side_b: list[CanonicalEntity]
) -> Detection:
    matches = match(side_a, side_b, run_id=EVAL_RUN_ID)
    entities = {entity_uuid(entity, EVAL_RUN_ID): entity for entity in [*side_a, *side_b]}
    return detect_detailed(matches, entities, run_id=EVAL_RUN_ID)


# ── Scoring ──────────────────────────────────────────────────────────────────


def score_run(
    detection: Detection,
    resolutions: list[Resolution],
    manifest: list[ManifestEntry],
    *,
    usage: ModelUsage | None = None,
    confidence_threshold: float | None = None,
) -> Metrics:
    """Compare one system's output against ground truth.

    A detected conflict is matched to a manifest entry on
    ``(entity external id, field)``. That is the only key the manifest and the
    pipeline genuinely share: ids are the manifest's subject and the field is
    what diverged, while values, classes and severities are all things the
    system under test is allowed to get wrong without being counted as having
    detected nothing.

    ``confidence_threshold`` re-derives the auto-apply decision post hoc, which
    is what makes the threshold sweep free: the model was already asked, and
    moving the gate changes only which side of it each answer falls on.
    """
    expected = {(entry.entity_id, entry.field): entry for entry in manifest}
    detected: dict[tuple[str, str], Conflict] = {}

    for conflict in detection.conflicts:
        origin = detection.origins.get(conflict.id) if conflict.id else None
        if origin is None:
            continue
        detected.setdefault((origin.entity_external_id, conflict.field), conflict)

    true_positive_keys = set(detected) & set(expected)
    false_positive_keys = set(detected) - set(expected)
    false_negative_keys = set(expected) - set(detected)

    precision = _ratio(len(true_positive_keys), len(detected))
    recall = _ratio(len(true_positive_keys), len(expected))
    f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)

    conflict_key = {
        conflict.id: key for key, conflict in detected.items() if conflict.id is not None
    }
    by_conflict_id = {conflict.id: conflict for conflict in detection.conflicts}

    resolved_correct = 0
    resolved_total = 0
    escalated_total = 0
    escalated_genuine = 0
    escalated_scoreable = 0
    auto_applied_total = 0
    false_auto_applies = 0

    for resolution in resolutions:
        resolved = by_conflict_id.get(resolution.conflict_id)
        key = conflict_key.get(resolution.conflict_id)
        entry = expected.get(key) if key else None

        status = resolution.status
        if confidence_threshold is not None and resolved is not None:
            status = (
                "auto_applied"
                if (
                    resolution.proposed_value
                    and resolution.confidence >= confidence_threshold
                    and resolved.severity <= AUTO_APPLY_MAX_SEVERITY
                )
                else "escalated"
            )

        if status == "escalated":
            escalated_total += 1
            if entry is not None:
                escalated_scoreable += 1
                if entry.expected_resolution == ESCALATE:
                    escalated_genuine += 1
            continue

        auto_applied_total += 1
        resolved_total += 1

        if entry is None:
            #: Auto-applying a conflict that is not in the manifest is a wrong
            #: write by construction — there was nothing to fix.
            false_auto_applies += 1
            continue

        if entry.expected_resolution != ESCALATE and (
            resolution.proposed_value == entry.expected_resolution
        ):
            resolved_correct += 1
        else:
            false_auto_applies += 1

    model_usage = usage or ModelUsage()

    return Metrics(
        precision=precision,
        recall=recall,
        f1=f1,
        resolution_accuracy=_ratio(resolved_correct, resolved_total),
        escalation_precision=_ratio(escalated_genuine, escalated_scoreable),
        false_auto_apply_rate=_ratio(false_auto_applies, auto_applied_total),
        escalation_rate=_ratio(escalated_total, len(resolutions)),
        tokens_used=model_usage.total_tokens,
        usd_per_1k_conflicts=_usd_per_1k(model_usage, len(detection.conflicts)),
        detected=len(detected),
        expected=len(expected),
        true_positives=len(true_positive_keys),
        false_positives=len(false_positive_keys),
        false_negatives=len(false_negative_keys),
        auto_applied=auto_applied_total,
        escalated=escalated_total,
        false_auto_applies=false_auto_applies,
        model_calls=model_usage.calls,
        model_errors=model_usage.errors,
        model_rate_limited=model_usage.rate_limited,
        first_error=model_usage.first_error,
    )


def _ratio(numerator: int, denominator: int) -> float:
    return 0.0 if denominator == 0 else numerator / denominator


def _usd_per_1k(usage: ModelUsage, conflicts: int) -> float:
    """Cost per 1,000 conflicts, on the rate card of whoever produced the tokens."""
    if conflicts == 0:
        return 0.0

    rates = RATE_CARDS[usage.provider]
    usd = (
        usage.input_tokens * rates.input
        + usage.output_tokens * rates.output
        + usage.cache_read_tokens * rates.cache_read
        + usage.cache_write_tokens * rates.cache_write
    ) / 1_000_000
    return usd / conflicts * 1000


# ── Ablations ────────────────────────────────────────────────────────────────


def ablate_without_validate(
    manifest: list[ManifestEntry],
    data_dir: Path,
    *,
    rules: list[SurvivorshipRule] | None = None,
    proposer: Proposer | None = None,
    usage: ModelUsage | None = None,
) -> Metrics:
    """Required ablation 1: does removing ``validate`` produce invented values?

    Quantify it. This is the empirical case for the node being non-optional.

    The proposer should be the *cached* one the full run used, so the two arms
    differ by the validate node and by nothing else — including sampling.
    """
    rules = rules if rules is not None else DEFAULT_RULESET
    side_a, side_b = load_sides(data_dir)
    detection = _redetect(side_a, side_b)

    resolutions = resolve(
        detection.conflicts,
        rules,
        origins=detection.origins,
        proposer=proposer,
        labels=LABELS,
        skip_validate=True,
    )
    return score_run(detection, resolutions, manifest, usage=usage)


def count_invented_values(
    detection: Detection,
    resolutions: list[Resolution],
) -> int:
    """Resolutions whose value is neither observed value nor a fold of one.

    The headline number for the validate ablation: with the node in place this
    is zero by construction, and what it becomes without the node is the whole
    finding.
    """
    from agent.graph import validate as _validate

    by_id = {conflict.id: conflict for conflict in detection.conflicts}
    invented = 0
    for resolution in resolutions:
        conflict = by_id.get(resolution.conflict_id)
        if conflict is None or not resolution.proposed_value:
            continue
        if not _validate(
            resolution.proposed_value, value_a=conflict.value_a, value_b=conflict.value_b
        ):
            invented += 1
    return invented


def sweep_auto_apply_threshold(
    manifest: list[ManifestEntry],
    data_dir: Path,
    *,
    start: float = 0.50,
    stop: float = 0.95,
    step: float = 0.05,
    run: SystemRun | None = None,
    rules: list[SurvivorshipRule] | None = None,
    proposer: Proposer | None = None,
) -> dict[float, Metrics]:
    """Required ablation 2: false auto-apply rate against escalation rate.

    This is the precision/recall tradeoff curve for the whole system, and the
    strongest single figure in the paper.

    It costs nothing beyond the run it sweeps: every proposal already carries a
    calibrated confidence, so moving the gate is arithmetic on results already
    in hand rather than a fresh pass over the model.
    """
    if run is None:
        run = execute(
            "canon_full", manifest, data_dir, rules=rules, proposer=proposer
        )

    detection = Detection(conflicts=run.conflicts, origins=dict(run.origins))

    results: dict[float, Metrics] = {}
    threshold = start
    while threshold <= stop + 1e-9:
        value = round(threshold, 2)
        results[value] = score_run(
            detection, run.resolutions, manifest, confidence_threshold=value
        )
        threshold += step

    return results


# ── CLI ──────────────────────────────────────────────────────────────────────


def main(argv: Sequence[str] | None = None) -> int:
    #: The harness is an entry point, so it owns this side effect exactly as
    #: main.py does for the server. Without it the provider's API key stays
    #: unset and `canon_full` silently degrades to the deterministic path —
    #: which looks like a result rather than a misconfiguration.
    load_dotenv()

    parser = argparse.ArgumentParser(
        prog="eval.harness", description="Score Canon against a ground-truth manifest."
    )
    parser.add_argument("--seed", type=int, default=42, help="dataset seed (locates ./data/runN)")
    parser.add_argument("--data", type=Path, default=None, help="dataset directory override")
    parser.add_argument(
        "--systems",
        default="all",
        help="comma-separated system names, or 'all'",
    )
    parser.add_argument("--report", action="store_true", help="write docs/results/")
    parser.add_argument(
        "--quick",
        action="store_true",
        help="cap model calls and skip ablations — for the post-change check",
    )
    parser.add_argument(
        "--provider",
        default="claude",
        choices=("claude", "gemini"),
        help="which model family resolves; reported alongside the numbers",
    )
    parser.add_argument(
        "--max-model-calls",
        type=int,
        default=None,
        help="hard ceiling on model calls; beyond it conflicts escalate",
    )
    parser.add_argument(
        "--no-model",
        action="store_true",
        help="run canon_full with no proposer — deterministic path only",
    )
    args = parser.parse_args(argv)

    data_dir = args.data or Path("./data") / f"run{args.seed}"
    if not data_dir.is_dir():
        parser.error(
            f"{data_dir} does not exist. Generate it first:\n"
            f"  uv run python -m eval.generate --seed {args.seed} "
            f"--accounts 500 --out {data_dir}"
        )

    manifest = load_manifest(data_dir)
    systems: tuple[System, ...] = (
        ALL_SYSTEMS
        if args.systems == "all"
        else tuple(_valid_system(name.strip(), parser) for name in args.systems.split(","))
    )

    max_calls = args.max_model_calls
    if args.quick and max_calls is None:
        max_calls = 25

    provider: ModelProvider = args.provider
    agent: ModelProposer | None = (
        None
        if args.no_model
        else build_proposer(DEFAULT_RULESET, provider=provider, max_calls=max_calls)
    )
    proposer: Proposer | None = CachingProposer(agent) if agent and agent.available else None

    if agent is not None and not agent.available:
        print(f"!  {missing_key_message(provider)}\n")

    print(f"dataset      {data_dir}")
    print(f"manifest     {len(manifest)} injected divergences")
    print(f"provider     {provider if proposer else '(no model)'}")
    print(f"resolution   {resolution_model(provider) if proposer else '(no model)'}")
    if max_calls is not None:
        print(f"call ceiling {max_calls}")
    print()

    runs: dict[System, SystemRun] = {}
    for system in systems:
        usage = agent.usage if (system == "canon_full" and agent) else None
        runs[system] = execute(
            system,
            manifest,
            data_dir,
            proposer=proposer if system == "canon_full" else None,
            usage=usage,
        )
        _print_metrics(system, runs[system].metrics)

    ablations: dict[str, Metrics] = {}
    invented = 0
    sweep: dict[float, Metrics] = {}

    if not args.quick and "canon_full" in runs:
        full = runs["canon_full"]
        sweep = sweep_auto_apply_threshold(manifest, data_dir, run=full)

        if proposer is not None:
            no_validate = ablate_without_validate(
                manifest, data_dir, proposer=proposer, usage=agent.usage if agent else None
            )
            ablations["no_validate"] = no_validate
            side_a, side_b = load_sides(data_dir)
            detection = _redetect(side_a, side_b)
            invented = count_invented_values(
                detection,
                resolve(
                    detection.conflicts,
                    DEFAULT_RULESET,
                    origins=detection.origins,
                    proposer=proposer,
                    labels=LABELS,
                    skip_validate=True,
                ),
            )
            _print_metrics("ablation: no validate node", no_validate)
            print(f"  invented values     {invented}")
            print()

    if args.report:
        from eval.report import write_report

        out = write_report(
            seed=args.seed,
            data_dir=data_dir,
            runs={name: run.metrics for name, run in runs.items()},
            ablations=ablations,
            sweep=sweep,
            invented_values=invented,
            provider=provider,
            model=resolution_model(provider) if proposer else "(no model)",
        )
        print(f"wrote {out}")

    return 0


def _valid_system(name: str, parser: argparse.ArgumentParser) -> System:
    if name not in ALL_SYSTEMS:
        parser.error(f"unknown system {name!r}; choose from {', '.join(ALL_SYSTEMS)}")
    return name


def _print_metrics(label: str, metrics: Metrics) -> None:
    print(f"-- {label}")
    print(
        f"  detection           P {metrics.precision:.3f}  R {metrics.recall:.3f}  "
        f"F1 {metrics.f1:.3f}"
        f"   (tp {metrics.true_positives}, fp {metrics.false_positives}, "
        f"fn {metrics.false_negatives})"
    )
    print(
        f"  resolution accuracy {metrics.resolution_accuracy:.3f}"
        f"   ({metrics.auto_applied} auto-applied)"
    )
    print(
        f"  false auto-apply    {metrics.false_auto_apply_rate:.3f}"
        f"   ({metrics.false_auto_applies} wrong writes)"
    )
    print(
        f"  escalation rate     {metrics.escalation_rate:.3f}"
        f"   precision {metrics.escalation_precision:.3f}"
    )
    print(
        f"  cost                {metrics.tokens_used} tokens, "
        f"${metrics.usd_per_1k_conflicts:.2f}/1k conflicts, "
        f"{metrics.model_calls} calls"
    )
    if metrics.model_rate_limited:
        #: Not an error line. A throttled call that succeeded on retry produced
        #: the agent's own answer; it just took longer to get it.
        print(
            f"  .  rate limited      {metrics.model_rate_limited} requests throttled "
            f"and retried -- wall-clock only, the numbers above still stand"
        )
    if metrics.model_errors:
        print(
            f"  !! model errors     {metrics.model_errors} calls failed and escalated "
            f"instead -- these numbers are NOT the agent's"
        )
        print(f"     first error      {metrics.first_error}")
    print()


def dump_json(runs: dict[System, Metrics], path: Path) -> None:
    """Machine-readable results, for diffing two commits' numbers."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({name: vars(metrics) for name, metrics in runs.items()}, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    raise SystemExit(main())
