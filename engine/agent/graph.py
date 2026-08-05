"""The resolution state machine (LangGraph).

    classify ──rule decides──▶ apply ────┐
        │                                 ├─▶ validate ─┬─ passes ─▶ auto_apply
        └──no rule / ambiguous──▶ propose ┘             └─ fails ──▶ escalate

Three rules govern this graph, and they are the difference between a system and
a wrapper:

1. **Deterministic first.** The model is called only for conflicts the ruleset
   does not decide. It keeps cost down, keeps most decisions explainable without
   reference to a model, and gives the evaluation a clean split between "rules
   handled it" and "the agent handled it".

2. **The model never invents a value.** ``validate`` rejects any
   ``proposed_value`` that is not one of the two observed values or a legal
   normalization of one. A hallucinated parent id is worse than an escalation.
   This check is deterministic and NON-NEGOTIABLE.

3. **Escalation is a success state, not a failure.** A system that escalates the
   genuinely ambiguous 8% and auto-resolves the rest correctly beats one that
   resolves 100% with silent errors.
"""

from __future__ import annotations

from pipeline.schema import Conflict, Resolution, SurvivorshipRule

# ── The auto-apply gate ──────────────────────────────────────────────────────
# Named constants, not magic numbers: eval/harness.py sweeps both of these and
# the tradeoff curve they trace is the strongest single figure in the paper.

#: Auto-apply requires at least this much confidence.
AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.85

#: Auto-apply is never permitted above this severity, at any confidence.
AUTO_APPLY_MAX_SEVERITY = 2


def should_auto_apply(*, confidence: float, severity: int) -> bool:
    """The gate, in one place. Both conditions, never either."""
    return confidence >= AUTO_APPLY_CONFIDENCE_THRESHOLD and severity <= AUTO_APPLY_MAX_SEVERITY


def select_rule(conflict: Conflict, rules: list[SurvivorshipRule]) -> SurvivorshipRule | None:
    """The ``classify`` node. Deterministic, most specific first, first match wins.

    Returns None when no rule matches — which escalates. Canon never guesses in
    the absence of policy.
    """
    raise NotImplementedError("Phase 3 — see AGENTS.md § The Resolution Agent")


def validate(proposed_value: str, *, value_a: str, value_b: str) -> bool:
    """The ``validate`` node. Deterministic and non-optional.

    True only if ``proposed_value`` is one of the two observed values or a legal
    normalization of one. Everything else is an invented value and is rejected,
    whether a rule or the model produced it.
    """
    raise NotImplementedError("Phase 3 — see AGENTS.md § The Resolution Agent")


def resolve(
    conflicts: list[Conflict],
    rules: list[SurvivorshipRule],
) -> list[Resolution]:
    """Run a batch of conflicts through the graph."""
    raise NotImplementedError("Phase 3 — see AGENTS.md § Feature List")
