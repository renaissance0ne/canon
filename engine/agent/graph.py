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

There is one edge the diagram above compresses: a rule whose strategy is
``escalate`` routes straight from ``classify`` to ``escalate``. Sending it to
``propose`` would spend a model call on a conflict the policy has already said
must never be auto-resolved.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol, TypedDict, cast
from uuid import UUID

from langgraph.graph import END, START, StateGraph

from agent.prompts import (
    MODEL_RESOLUTION,
    SUBMIT_RESOLUTION_TOOL,
    build_conflict_block,
    build_ruleset_block,
)
from pipeline.detect import ConflictOrigin
from pipeline.normalize import fold_name
from pipeline.schema import (
    Conflict,
    Resolution,
    ResolutionStatus,
    SurvivorshipRule,
    rule_specificity,
)

# ── The auto-apply gate ──────────────────────────────────────────────────────
# Named constants, not magic numbers: eval/harness.py sweeps both of these and
# the tradeoff curve they trace is the strongest single figure in the paper.

#: Auto-apply requires at least this much confidence.
AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.85

#: Auto-apply is never permitted above this severity, at any confidence.
AUTO_APPLY_MAX_SEVERITY = 2

#: Confidence attached to a value a deterministic rule chose. High but not 1.0:
#: the rule fired on unambiguous evidence, yet the policy encoded in the rule is
#: itself a human judgement that can be wrong, and a system that reports
#: certainty it does not have cannot be calibrated.
RULE_CONFIDENCE = 0.95

#: Default column labels when a caller supplies none. Rationales are read by
#: humans, so a raw source uuid in the sentence is a defect.
DEFAULT_LABELS: tuple[str, str] = ("source A", "source B")

#: Three deliberately opaque aliases, named so the reason travels with them.
#:
#: The Anthropic SDK is fully typed, but its request TypedDicts will not accept
#: the tool schema as a plain dict — restating that schema in SDK types would
#: put the tool contract in two places, and the contract is the one thing that
#: must have a single definition. LangGraph ships no type information at all
#: (see the mypy overrides in pyproject.toml). Everything Canon writes around
#: these boundaries is still checked.
AnthropicClient = Any
AnthropicMessage = Any
CompiledGraph = Any


def should_auto_apply(*, confidence: float, severity: int) -> bool:
    """The gate, in one place. Both conditions, never either."""
    return confidence >= AUTO_APPLY_CONFIDENCE_THRESHOLD and severity <= AUTO_APPLY_MAX_SEVERITY


def select_rule(
    conflict: Conflict,
    rules: list[SurvivorshipRule],
    *,
    entity_type: str | None = None,
) -> SurvivorshipRule | None:
    """The ``classify`` node. Deterministic, most specific first, first match wins.

    Returns None when no rule matches — which escalates. Canon never guesses in
    the absence of policy.

    ``entity_type`` is a parameter rather than a field on ``Conflict`` because
    the conflict shape crosses the layer boundary and the web layer has no use
    for it; detection reports it alongside, in ``ConflictOrigin``. When it is
    unknown only entity-wildcard rules can match, which is the conservative
    reading: a rule scoped to ``user`` must not fire on a record whose type
    nobody established.
    """
    ordered = sorted(rules, key=rule_specificity, reverse=True)

    for rule in ordered:
        if rule.field not in ("*", conflict.field):
            continue
        if rule.entity_type != "*" and rule.entity_type != entity_type:
            continue
        return rule

    return None


def validate(proposed_value: str, *, value_a: str, value_b: str) -> bool:
    """The ``validate`` node. Deterministic and non-optional.

    True only if ``proposed_value`` is one of the two observed values or a legal
    normalization of one. Everything else is an invented value and is rejected,
    whether a rule or the model produced it.

    An empty proposal is rejected outright rather than folded against an empty
    observed value — for an orphan, ``value_b`` is legitimately empty, and
    letting "" validate against it would turn "I have no answer" into an
    accepted resolution.
    """
    if not proposed_value:
        return False
    if proposed_value in (value_a, value_b):
        return True

    folded = fold_name(proposed_value)
    return folded in {fold_name(value_a), fold_name(value_b)} and folded != ""


# ── Deterministic rule application ───────────────────────────────────────────


@dataclass(frozen=True)
class RuleDecision:
    """A value a rule chose, and the evidence it chose it on."""

    value: str
    reason: str


def apply_rule(
    rule: SurvivorshipRule,
    conflict: Conflict,
    origin: ConflictOrigin | None,
    *,
    labels: tuple[str, str] = DEFAULT_LABELS,
) -> RuleDecision | None:
    """Run one survivorship strategy. ``None`` means the rule did not decide.

    Not deciding is a normal, frequent outcome — ``most_recent`` cannot rank two
    edits made in the same second, and that is precisely the conflict the
    generator injects to test escalation. Returning None here is what sends it
    onward rather than inventing a tiebreak.
    """
    label_a, label_b = labels

    match rule.strategy:
        case "escalate":
            return None

        case "prefer_source":
            if origin is None or rule.preferred_source_id is None:
                return None
            if rule.preferred_source_id == origin.source_a_id:
                return RuleDecision(conflict.value_a, f"{label_a} is authoritative for this field")
            if rule.preferred_source_id == origin.source_b_id:
                return RuleDecision(conflict.value_b, f"{label_b} is authoritative for this field")
            return None

        case "most_recent":
            if origin is None:
                return None
            when_a = _parse_timestamp(origin.last_modified_a)
            when_b = _parse_timestamp(origin.last_modified_b)
            if when_a is None or when_b is None or when_a == when_b:
                return None
            if when_a > when_b:
                return RuleDecision(conflict.value_a, f"{label_a} holds the more recent edit")
            return RuleDecision(conflict.value_b, f"{label_b} holds the more recent edit")

        case "most_complete":
            if bool(conflict.value_a) != bool(conflict.value_b):
                if conflict.value_a:
                    return RuleDecision(conflict.value_a, f"only {label_a} has a value")
                return RuleDecision(conflict.value_b, f"only {label_b} has a value")
            if len(conflict.value_a) > len(conflict.value_b):
                return RuleDecision(conflict.value_a, f"{label_a} carries the fuller value")
            if len(conflict.value_b) > len(conflict.value_a):
                return RuleDecision(conflict.value_b, f"{label_b} carries the fuller value")
            return None


# ── The model-backed propose node ────────────────────────────────────────────


@dataclass(frozen=True)
class Proposal:
    """What the model returned, before validation."""

    proposed_value: str
    rationale: str
    confidence: float
    applied_rule_id: str | None


@dataclass
class ModelUsage:
    """Token accounting for one run. Reported, never estimated."""

    calls: int = 0
    errors: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    #: The first failure's message, kept so a caller can say *why* the agent
    #: never ran. A run that degraded to the deterministic path because of an
    #: expired key looks exactly like a run that had no work for the agent, and
    #: reporting the second when the first happened is how a broken pipeline
    #: gets written up as a result.
    first_error: str = ""

    @property
    def total_tokens(self) -> int:
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_read_tokens
            + self.cache_write_tokens
        )


class Proposer(Protocol):
    """Anything that can turn an undecided conflict into a proposal."""

    def __call__(
        self,
        conflict: Conflict,
        origin: ConflictOrigin | None,
        labels: tuple[str, str],
    ) -> Proposal | None: ...


class ClaudeProposer:
    """The ``propose`` node, backed by Claude.

    Two cost levers are structural rather than optional. The ruleset block is
    built once and sent as a cached system prefix, because it is byte-identical
    across every call in a run and is by far the largest part of each prompt.
    And the model answers only through a forced tool call — free text would have
    to be parsed, and a value recovered from prose cannot be compared against
    the observed values exactly enough for ``validate`` to mean anything.
    """

    def __init__(
        self,
        rules: list[SurvivorshipRule],
        *,
        client: AnthropicClient | None = None,
        model: str = MODEL_RESOLUTION,
        max_calls: int | None = None,
    ) -> None:
        self.usage = ModelUsage()
        self.model = model
        self.max_calls = max_calls
        #: Requests issued, successful or not — the quantity `max_calls` bounds.
        self.attempts = 0
        self._ruleset_block = build_ruleset_block(rules)
        self._client = client if client is not None else _default_client()

    @property
    def available(self) -> bool:
        return self._client is not None

    def __call__(
        self,
        conflict: Conflict,
        origin: ConflictOrigin | None,
        labels: tuple[str, str],
    ) -> Proposal | None:
        if self._client is None:
            return None
        #: Attempts, not successes. Counting only successes means a failing
        #: endpoint is retried once per conflict and the ceiling that exists to
        #: bound a run never trips.
        if self.max_calls is not None and self.attempts >= self.max_calls:
            return None

        label_a, label_b = labels
        block = build_conflict_block(
            conflict,
            entity_type=origin.entity_type if origin else "unknown",
            entity_external_id=origin.entity_external_id if origin else "unknown",
            source_a_label=label_a,
            source_b_label=label_b,
            last_modified_a=origin.last_modified_a if origin else None,
            last_modified_b=origin.last_modified_b if origin else None,
        )

        self.attempts += 1
        try:
            message = self._client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=[
                    {
                        "type": "text",
                        "text": self._ruleset_block,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                #: Thinking off: the decision is a choice between two supplied
                #: values under a quoted rule, and the reasoning that matters is
                #: the rationale the reviewer reads, not a hidden scratchpad.
                thinking={"type": "disabled"},
                tools=[SUBMIT_RESOLUTION_TOOL],
                tool_choice={"type": "tool", "name": "submit_resolution"},
                messages=[{"role": "user", "content": block}],
            )
        except Exception as error:
            #: A failed call escalates. It never falls back to a guess — an
            #: outage must not quietly change what the system decides. It is
            #: recorded rather than swallowed, so the run reports the outage.
            self.usage.errors += 1
            if not self.usage.first_error:
                self.usage.first_error = f"{type(error).__name__}: {error}"
            return None

        self._record(message)
        return _read_proposal(message)

    def _record(self, message: AnthropicMessage) -> None:
        usage = getattr(message, "usage", None)
        self.usage.calls += 1
        if usage is None:
            return
        self.usage.input_tokens += int(getattr(usage, "input_tokens", 0) or 0)
        self.usage.output_tokens += int(getattr(usage, "output_tokens", 0) or 0)
        self.usage.cache_read_tokens += int(getattr(usage, "cache_read_input_tokens", 0) or 0)
        self.usage.cache_write_tokens += int(
            getattr(usage, "cache_creation_input_tokens", 0) or 0
        )


def _default_client() -> AnthropicClient | None:
    """An Anthropic client, or None when the engine has no key configured.

    None rather than an exception: the deterministic half of the pipeline is
    fully runnable without a key, and `baseline_rules` must stay runnable on a
    machine that has never been given one.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    try:
        import anthropic
    except ImportError:
        return None
    return anthropic.Anthropic()


def _read_proposal(message: AnthropicMessage) -> Proposal | None:
    for block in getattr(message, "content", []):
        if getattr(block, "type", None) != "tool_use":
            continue
        payload = getattr(block, "input", None)
        if not isinstance(payload, dict):
            continue
        try:
            confidence = float(payload.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        return Proposal(
            proposed_value=str(payload.get("proposed_value") or ""),
            rationale=str(payload.get("rationale") or ""),
            confidence=min(max(confidence, 0.0), 1.0),
            applied_rule_id=(
                str(payload["applied_rule_id"])
                if payload.get("applied_rule_id") is not None
                else None
            ),
        )
    return None


# ── The graph ────────────────────────────────────────────────────────────────


class ResolutionState(TypedDict, total=False):
    """One conflict's journey through the machine."""

    conflict: Conflict
    origin: ConflictOrigin | None
    rules: list[SurvivorshipRule]
    labels: tuple[str, str]
    rule: SurvivorshipRule | None
    decision: RuleDecision | None
    proposed_value: str
    rationale: str
    confidence: float
    applied_rule_id: str | None
    status: ResolutionStatus
    escalation_reason: str


def _classify(state: ResolutionState) -> ResolutionState:
    conflict = state["conflict"]
    origin = state.get("origin")
    rule = select_rule(
        conflict,
        state["rules"],
        entity_type=origin.entity_type if origin else None,
    )
    decision = (
        apply_rule(rule, conflict, origin, labels=state["labels"]) if rule is not None else None
    )
    return cast(ResolutionState, {"rule": rule, "decision": decision})


def _route_after_classify(state: ResolutionState) -> str:
    rule = state.get("rule")
    if rule is not None and rule.strategy == "escalate":
        return "escalate"
    if state.get("decision") is not None:
        return "apply"
    return "propose"


def _apply(state: ResolutionState) -> ResolutionState:
    conflict = state["conflict"]
    decision = state["decision"]
    rule = state["rule"]
    assert decision is not None and rule is not None  # routing guarantees both
    label_a, label_b = state["labels"]

    rationale = (
        f"{label_a} shows {conflict.value_a or '(absent)'} "
        f"(modified {_short_date(state.get('origin'), side='a')}); "
        f"{label_b} shows {conflict.value_b or '(absent)'} "
        f"(modified {_short_date(state.get('origin'), side='b')}). "
        f"Applied {rule.strategy} via rule {rule.id} — {decision.reason}, "
        f"so {decision.value or '(absent)'} wins"
        f"{'; this edge drives hierarchy rollups' if conflict.severity == 4 else ''}."
    )

    return cast(
        ResolutionState,
        {
            "proposed_value": decision.value,
            "rationale": rationale,
            "confidence": RULE_CONFIDENCE,
            "applied_rule_id": rule.id,
        },
    )


def _make_propose(
    proposer: Proposer | None,
) -> Callable[[ResolutionState], ResolutionState]:
    def _propose(state: ResolutionState) -> ResolutionState:
        if proposer is None:
            return cast(
                ResolutionState,
                {
                    "proposed_value": "",
                    "rationale": "",
                    "confidence": 0.0,
                    "applied_rule_id": None,
                    "escalation_reason": "no rule covers this field and no model was configured",
                },
            )

        proposal = proposer(state["conflict"], state.get("origin"), state["labels"])
        if proposal is None:
            return cast(
                ResolutionState,
                {
                    "proposed_value": "",
                    "rationale": "",
                    "confidence": 0.0,
                    "applied_rule_id": None,
                    "escalation_reason": "the model did not return a usable proposal",
                },
            )

        return cast(
            ResolutionState,
            {
                "proposed_value": proposal.proposed_value,
                "rationale": proposal.rationale,
                "confidence": proposal.confidence,
                "applied_rule_id": proposal.applied_rule_id,
                "escalation_reason": (
                    "" if proposal.proposed_value else "the model judged this genuinely ambiguous"
                ),
            },
        )

    return _propose


def _validate_node(state: ResolutionState) -> ResolutionState:
    return state


def _route_after_validate(state: ResolutionState) -> str:
    conflict = state["conflict"]
    proposed = state.get("proposed_value", "")

    if not validate(proposed, value_a=conflict.value_a, value_b=conflict.value_b):
        return "escalate"
    if not should_auto_apply(
        confidence=state.get("confidence", 0.0), severity=conflict.severity
    ):
        return "escalate"
    return "auto_apply"


def _auto_apply(state: ResolutionState) -> ResolutionState:
    return cast(ResolutionState, {"status": "auto_applied"})


def _escalate(state: ResolutionState) -> ResolutionState:
    conflict = state["conflict"]
    proposed = state.get("proposed_value", "")
    rationale = state.get("rationale", "")
    reason = state.get("escalation_reason", "")
    rule = state.get("rule")

    if rule is not None and rule.strategy == "escalate":
        rationale = (
            f"Rule {rule.id} marks {conflict.field} as never auto-resolved. "
            f"{rule.description}"
        )
        proposed = ""
    elif proposed and not validate(
        proposed, value_a=conflict.value_a, value_b=conflict.value_b
    ):
        #: The one non-negotiable rejection. Recording it in the rationale is
        #: what makes the validate-node ablation legible in the audit trail
        #: rather than only in an aggregate number.
        rationale = (
            f"Proposed value {proposed!r} is neither observed value and was rejected. "
            f"Escalated for human review."
        )
        proposed = ""
    elif not rationale:
        rationale = (
            f"Neither side could be preferred on the evidence available"
            f"{f' — {reason}' if reason else ''}. Escalated for human review."
        )

    return cast(
        ResolutionState,
        {"status": "escalated", "proposed_value": proposed, "rationale": rationale},
    )


def build_graph(*, proposer: Proposer | None = None) -> CompiledGraph:
    """Compile the state machine once; invoke it per conflict.

    Kept as its own function because the graph's shape is a figure in the paper
    and a reader should be able to see the whole topology in one screen.
    """
    builder = StateGraph(ResolutionState)

    builder.add_node("classify", _classify)
    builder.add_node("apply", _apply)
    #: cast: the node is correctly shaped, but LangGraph's `add_node`
    #: overloads do not accept an already-annotated Callable.
    builder.add_node("propose", cast(Any, _make_propose(proposer)))
    builder.add_node("validate", _validate_node)
    builder.add_node("auto_apply", _auto_apply)
    builder.add_node("escalate", _escalate)

    builder.add_edge(START, "classify")
    builder.add_conditional_edges(
        "classify",
        _route_after_classify,
        {"apply": "apply", "propose": "propose", "escalate": "escalate"},
    )
    builder.add_edge("apply", "validate")
    builder.add_edge("propose", "validate")
    builder.add_conditional_edges(
        "validate",
        _route_after_validate,
        {"auto_apply": "auto_apply", "escalate": "escalate"},
    )
    builder.add_edge("auto_apply", END)
    builder.add_edge("escalate", END)

    return builder.compile()


def resolve(
    conflicts: list[Conflict],
    rules: list[SurvivorshipRule],
    *,
    origins: dict[UUID, ConflictOrigin] | None = None,
    proposer: Proposer | None = None,
    labels: tuple[str, str] = DEFAULT_LABELS,
    skip_validate: bool = False,
) -> list[Resolution]:
    """Run a batch of conflicts through the graph.

    ``skip_validate`` exists for exactly one caller: the required ablation that
    measures what the validate node is worth. It is never set in production, and
    the harness reports it as a separate system rather than folding it into the
    headline numbers.
    """
    graph = build_graph(proposer=proposer) if not skip_validate else None
    resolutions: list[Resolution] = []

    for conflict in conflicts:
        origin = origins.get(conflict.id) if origins and conflict.id is not None else None

        if skip_validate:
            resolutions.append(
                _resolve_without_validate(conflict, rules, origin, proposer, labels)
            )
            continue

        assert graph is not None
        final = graph.invoke(
            {
                "conflict": conflict,
                "origin": origin,
                "rules": rules,
                "labels": labels,
                "proposed_value": "",
                "rationale": "",
                "confidence": 0.0,
                "applied_rule_id": None,
                "escalation_reason": "",
            }
        )

        resolutions.append(
            Resolution(
                conflict_id=_conflict_id(conflict),
                proposed_value=final.get("proposed_value", ""),
                rationale=final.get("rationale", ""),
                applied_rule_id=final.get("applied_rule_id"),
                confidence=final.get("confidence", 0.0),
                status=final.get("status", "escalated"),
            )
        )

    return resolutions


def _resolve_without_validate(
    conflict: Conflict,
    rules: list[SurvivorshipRule],
    origin: ConflictOrigin | None,
    proposer: Proposer | None,
    labels: tuple[str, str],
) -> Resolution:
    """The ablation path: identical to the graph, minus the validate node.

    Written out rather than parameterized into the graph so the thing being
    ablated is visibly absent — a boolean threaded through ``_route_after_validate``
    would leave a reader unsure which check actually got removed.
    """
    rule = select_rule(
        conflict, rules, entity_type=origin.entity_type if origin else None
    )
    decision = apply_rule(rule, conflict, origin, labels=labels) if rule is not None else None

    if rule is not None and rule.strategy == "escalate":
        return Resolution(
            conflict_id=_conflict_id(conflict),
            proposed_value="",
            rationale=f"Rule {rule.id} marks {conflict.field} as never auto-resolved.",
            applied_rule_id=rule.id,
            confidence=0.0,
            status="escalated",
        )

    if decision is not None:
        assert rule is not None  # a decision can only come from a rule
        proposed = decision.value
        rationale = f"Applied {rule.strategy} via rule {rule.id}."
        confidence = RULE_CONFIDENCE
        applied: str | None = rule.id
    elif proposer is not None:
        proposal = proposer(conflict, origin, labels)
        if proposal is None:
            return Resolution(
                conflict_id=_conflict_id(conflict),
                proposed_value="",
                rationale="No proposal was returned.",
                applied_rule_id=None,
                confidence=0.0,
                status="escalated",
            )
        proposed = proposal.proposed_value
        rationale = proposal.rationale
        confidence = proposal.confidence
        applied = proposal.applied_rule_id
    else:
        return Resolution(
            conflict_id=_conflict_id(conflict),
            proposed_value="",
            rationale="No rule and no model.",
            applied_rule_id=None,
            confidence=0.0,
            status="escalated",
        )

    status: ResolutionStatus = (
        "auto_applied"
        if proposed and should_auto_apply(confidence=confidence, severity=conflict.severity)
        else "escalated"
    )
    return Resolution(
        conflict_id=_conflict_id(conflict),
        proposed_value=proposed,
        rationale=rationale,
        applied_rule_id=applied,
        confidence=confidence,
        status=status,
    )


# ── helpers ──────────────────────────────────────────────────────────────────


def _conflict_id(conflict: Conflict) -> UUID:
    if conflict.id is None:
        raise ValueError("conflicts must carry an id before they can be resolved")
    return conflict.id


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _short_date(origin: ConflictOrigin | None, *, side: str) -> str:
    if origin is None:
        return "unknown"
    raw = origin.last_modified_a if side == "a" else origin.last_modified_b
    parsed = _parse_timestamp(raw)
    return parsed.date().isoformat() if parsed else (raw or "unknown")
