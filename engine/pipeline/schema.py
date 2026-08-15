"""The tool contract.

Mirrors ``web/types/`` exactly. Every payload crossing the layer boundary is a
model defined here — no bare dicts. AGENTS.md: *do not change one side without
changing the other in the same commit.*

The wire format is camelCase because the web layer speaks it; Python stays
snake_case. ``CanonModel`` carries that translation so no call site has to.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

# ── Enumerations (mirror the Zod enums in web/types/) ────────────────────────

EntityType = Literal["account", "user", "role", "territory"]
SourceKind = Literal["salesforce", "hubspot", "databricks", "snowflake", "synthetic"]
RuleStrategy = Literal["prefer_source", "most_recent", "most_complete", "escalate"]
#: Which model family the `propose` node calls. Recorded on the run row for the
#: same reason `ruleset_id` is: two runs that disagree are only comparable if
#: what produced each answer is on the record. Mirrored in
#: web/types/run.ts::modelProviderSchema.
ModelProvider = Literal["claude", "gemini"]
RunStatus = Literal[
    "queued", "extracting", "matching", "detecting", "resolving", "complete", "failed"
]
ConflictClass = Literal["structural", "attribute", "cosmetic", "orphan", "duplicate"]
#: ``orphan`` is not a matching technique — it is the absence of one. An entity
#: with no counterpart still needs a row in ``matches`` because ``conflicts``
#: requires a match to point at and the console's queue inner-joins through it;
#: that row is self-referential (both sides the same entity) with confidence 0.
#: Naming the method honestly is what keeps a reader from mistaking a
#: self-referential row for a real pairing.
#: Mirrored in web/types/conflict.ts::matchMethodSchema.
MatchMethod = Literal["exact_key", "embedding", "fuzzy", "agent", "orphan"]
ResolutionStatus = Literal[
    "proposed", "auto_applied", "escalated", "approved", "rejected", "overridden"
]
#: The engine writes the first five and the last; the web layer writes the
#: human_* three. ``human_rejected`` is not in AGENTS.md § Database Schema's
#: list — it has to exist, because a rejection recorded as any other action
#: would put a false statement in the one table that is beyond dispute.
#: Mirrored in web/types/resolution.ts::auditActionSchema.
#: ``run_degraded`` is the second action not in AGENTS.md § Database Schema's
#: original list, and it exists for the same reason ``human_rejected`` does: the
#: system has a state it could not otherwise name truthfully. A run whose model
#: calls failed COMPLETED — it is not ``run_failed`` — but its escalation count
#: is not the agent's judgement. Recording that as anything else, or not at all,
#: leaves the audit trail asserting a clean run.
AuditAction = Literal[
    "run_started",
    "conflict_detected",
    "resolution_proposed",
    "auto_applied",
    "escalated",
    "human_approved",
    "human_rejected",
    "human_overridden",
    "run_degraded",
    "run_failed",
]

#: 4 structural · 3 attribute (ownership) · 2 attribute (non-rollup) · 1 cosmetic.
#: An integer the auto-apply gate reads, not a hue — see AGENTS.md § Severity Model.
Severity = Literal[1, 2, 3, 4]

DetectedBy = Literal["rule", "agent"]


class CanonModel(BaseModel):
    """Base for every model on the boundary: camelCase on the wire, snake_case here."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


# ── Entities ─────────────────────────────────────────────────────────────────


class CanonicalEntity(CanonModel):
    """A record from either side, normalized. Mirrors web/types/entity.ts."""

    external_id: str
    entity_type: EntityType
    name: str
    #: Folded; what matching actually compares. Folding is recorded, not destructive.
    normalized_name: str
    #: The hierarchy edge.
    parent_external_id: str | None = None
    attributes: dict[str, str | None] = Field(default_factory=dict)
    #: ISO 8601 — drives recency survivorship.
    last_modified_at: str | None = None
    source_id: str


# ── Survivorship ─────────────────────────────────────────────────────────────


class SurvivorshipRule(CanonModel):
    """Mirrors web/types/rules.ts.

    Rules are evaluated most specific first: exact ``field`` + exact
    ``entity_type`` beats a wildcard on either. First match wins. If no rule
    matches, the conflict escalates — Canon never guesses in the absence of
    policy.
    """

    id: str
    #: ``"*"`` applies to any field.
    field: str
    entity_type: str
    strategy: RuleStrategy
    preferred_source_id: str | None = None
    #: Plain English — goes into the agent prompt.
    description: str

    @model_validator(mode="after")
    def _prefer_source_needs_a_source(self) -> SurvivorshipRule:
        if self.strategy == "prefer_source" and not self.preferred_source_id:
            raise ValueError("preferred_source_id is required when strategy is prefer_source")
        return self


def rule_specificity(rule: SurvivorshipRule) -> int:
    """Higher is more specific. Ties keep author order, so first match wins."""
    return (0 if rule.field == "*" else 2) + (0 if rule.entity_type == "*" else 1)


# ── Matching and detection ───────────────────────────────────────────────────


class MatchSignals(CanonModel):
    """What the combined confidence was computed from."""

    exact_key: bool
    cosine: float
    fuzzy_ratio: float


class Match(CanonModel):
    """A pair of entities believed to be the same real-world thing."""

    id: UUID | None = None
    run_id: UUID
    entity_a_id: UUID
    entity_b_id: UUID
    confidence: float = Field(ge=0.0, le=1.0)
    method: MatchMethod
    signals: MatchSignals


class Conflict(CanonModel):
    """A field-level disagreement within a match. Mirrors web/types/conflict.ts."""

    id: UUID | None = None
    run_id: UUID
    match_id: UUID
    field: str
    value_a: str
    value_b: str
    conflict_class: ConflictClass
    severity: Severity
    detected_by: DetectedBy


class Resolution(CanonModel):
    """The proposed and final answer for a conflict."""

    id: UUID | None = None
    conflict_id: UUID
    #: `validate` guarantees this is an observed value or a legal normalization.
    proposed_value: str
    #: Plain-English, agent-authored. A reviewer decides from this in five seconds.
    rationale: str
    #: Which survivorship rule fired, if any.
    applied_rule_id: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    status: ResolutionStatus = "proposed"
    reviewed_by: str | None = None
    override_value: str | None = None
    created_at: datetime | None = None
    reviewed_at: datetime | None = None


# ── Run control (the HTTP surface in main.py) ────────────────────────────────


class RunStats(CanonModel):
    """Mirrors web/types/run.ts. Every field is a headline number in the console."""

    entities_a: int = 0
    entities_b: int = 0
    candidate_pairs: int = 0
    matches: int = 0
    conflicts: int = 0
    auto_resolved: int = 0
    escalated: int = 0
    tokens_used: int = 0

    # ── Agent health ─────────────────────────────────────────────────────────
    # A failed model call escalates. That is the correct behaviour, but it means
    # `escalated` silently mixes two different facts: conflicts the agent judged
    # genuinely ambiguous, and conflicts nobody ever got an answer for. Without
    # these three, a run throttled into escalating most of its work is
    # indistinguishable from a run that found that much real ambiguity — the
    # eval harness has always said so loudly, and the console could not say it
    # at all.
    #: Model requests that returned an answer.
    model_calls: int = 0
    #: Requests that failed and escalated instead. Every one of these is an
    #: escalation that is NOT a statement about the conflict.
    model_errors: int = 0
    #: Requests the provider throttled and that were retried. Cost wall-clock,
    #: not correctness — a run can be slow and still be entirely trustworthy.
    model_rate_limited: int = 0


class StartRunRequest(CanonModel):
    """POST {ENGINE_URL}/runs.

    Only the id crosses the wire. The engine reads sources and ruleset from
    Postgres using ``run_id``: passing configuration would create two sources of
    truth for what a run actually executed, which breaks reproducibility.
    """

    run_id: UUID


class StartRunResponse(CanonModel):
    run_id: UUID
    accepted: Literal[True] = True


class RunStatusResponse(CanonModel):
    """GET {ENGINE_URL}/runs/:runId/status — polled by the console."""

    run_id: UUID
    status: RunStatus
    stats: RunStats
    error: str | None = None


class ProviderStatus(CanonModel):
    """One model provider, and whether this engine can actually call it.

    ``configured`` reports the presence of a key, never the key. The console
    reads this to default the run form to a provider that will work and to say
    why the other one will not — the same reasoning that puts "not connected"
    next to a source with no stored credentials.
    """

    provider: ModelProvider
    #: The resolution model this engine would use. Named so the console shows
    #: what a run will execute rather than a family label.
    model: str
    configured: bool


class ProvidersResponse(CanonModel):
    """GET {ENGINE_URL}/providers — read by the new-run screen."""

    providers: list[ProviderStatus]
