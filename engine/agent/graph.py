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

import json
import os
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol, TypedDict, cast
from uuid import UUID

from langgraph.graph import END, START, StateGraph

from agent.prompts import (
    API_KEY_ENV,
    SUBMIT_RESOLUTION_NAME,
    SUBMIT_RESOLUTION_TOOL,
    build_conflict_block,
    build_ruleset_block,
    gemini_parameters_json_schema,
    missing_settings,
    openai_function_tool,
    resolution_model,
)
from pipeline.detect import ConflictOrigin

if TYPE_CHECKING:
    # Imported for annotations only; the client itself is built lazily in
    # `_default_azure_openai_client`, like the two SDK clients.
    import httpx
from pipeline.normalize import fold_name
from pipeline.schema import (
    Conflict,
    ModelProvider,
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

#: Retries granted to a rate-limited call, on top of the first attempt.
#:
#: Two, not "until it works". A free-tier key is a handful of requests per
#: minute, so a batch of several hundred conflicts WILL be throttled and a run
#: that gave up on the first 429 would escalate most of its work for a reason
#: that has nothing to do with the conflicts. But an unbounded retry turns a
#: quota exhausted for the day into a run that never finishes and never says
#: why, which is worse than escalating with the reason on the record.
RATE_LIMIT_RETRIES = 2

#: Never sleep longer than this, whatever the provider advises. A `retryDelay`
#: measured in minutes means the quota is gone, not busy — waiting it out inside
#: a request handler would hold the run open for an answer that is not coming.
MAX_RETRY_SECONDS = 60.0

#: Fallback wait when the provider does not say how long. Deliberately longer
#: than a per-minute window is short, so one retry actually clears it.
DEFAULT_RETRY_SECONDS = 20.0

#: Conflicts resolved at once when the model is in play.
#:
#: A model call is a network round trip of a second or more, and the conflicts
#: in a batch are independent, so resolving them one after another leaves the
#: run idle for almost its entire resolve stage. Four in flight cuts that wall
#: clock by roughly four on a paid tier while staying under every provider's
#: default per-minute ceiling.
#:
#: It is not a fixed fan-out: the first rate limit a provider returns drops the
#: proposer to one request at a time for the rest of the run (see
#: `ModelProposer`), so a free-tier key degrades to exactly the serial
#: behaviour it had before rather than burning its retries on a burst.
DEFAULT_MODEL_CONCURRENCY = 4

#: Overrides the fan-out without a code change. 1 restores strictly serial calls.
MODEL_CONCURRENCY_ENV = "CANON_MODEL_CONCURRENCY"

#: Never more than this, whatever the environment says. Past it the provider's
#: rate limit, not the engine, sets the pace, and each extra thread is only
#: another request queued to be throttled.
MAX_MODEL_CONCURRENCY = 16

#: Deliberately opaque aliases, named so the reason travels with them.
#:
#: The Anthropic and Google SDKs are both fully typed, but their request
#: TypedDicts will not accept the tool schema as a plain dict — restating that
#: schema in SDK types would put the tool contract in two places, and the
#: contract is the one thing that must have a single definition. LangGraph ships
#: no type information at all (see the mypy overrides in pyproject.toml).
#: Everything Canon writes around these boundaries is still checked.
ModelClient = Any
ModelResponse = Any
ModelConfig = Any
CompiledGraph = Any


def should_auto_apply(*, confidence: float, severity: int) -> bool:
    """The gate, in one place. Both conditions, never either."""
    return confidence >= AUTO_APPLY_CONFIDENCE_THRESHOLD and severity <= AUTO_APPLY_MAX_SEVERITY


def model_concurrency() -> int:
    """How many conflicts may be with the model at once, from the environment.

    A malformed value falls back to the default rather than failing the run: a
    typo in a tuning knob should cost wall-clock, not a reconciliation.
    """
    raw = os.environ.get(MODEL_CONCURRENCY_ENV, "")
    try:
        wanted = int(raw) if raw.strip() else DEFAULT_MODEL_CONCURRENCY
    except ValueError:
        wanted = DEFAULT_MODEL_CONCURRENCY
    return min(max(wanted, 1), MAX_MODEL_CONCURRENCY)


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

    #: Whose rate card applies. Tokens without it are not costable — the two
    #: providers differ by an order of magnitude per million, so a total that
    #: does not say who produced it cannot be turned into a dollar figure.
    provider: ModelProvider = "claude"
    calls: int = 0
    #: Conflicts that reached the proposer and got no answer: failed requests,
    #: and conflicts skipped after an unrecoverable error halted the proposer.
    errors: int = 0
    #: Requests the provider throttled and that were retried. Reported
    #: separately from `errors` because a throttled call that later succeeded
    #: cost wall-clock, not correctness — folding it into the error count would
    #: make a slow run look like a broken one.
    rate_limited: int = 0
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


class ModelProposer:
    """The ``propose`` node's shared skeleton. One subclass per provider.

    Everything that is a *policy* rather than an API detail lives here, so the
    two providers cannot drift apart on any of it: the call ceiling, what
    happens when a request fails, and the fact that a run's prompts are built
    exactly once from the ruleset. A subclass supplies only the request itself.

    Two cost levers are structural rather than optional, and both are honoured
    by every subclass. The ruleset block is built once and sent as a cached
    system prefix, because it is byte-identical across every call in a run and
    is by far the largest part of each prompt. And the model answers only
    through a forced tool call — free text would have to be parsed, and a value
    recovered from prose cannot be compared against the observed values exactly
    enough for ``validate`` to mean anything.
    """

    #: Which family this is, for the audit trail and the run row.
    provider: ModelProvider

    def __init__(
        self,
        rules: list[SurvivorshipRule],
        *,
        model: str | None = None,
        max_calls: int | None = None,
    ) -> None:
        self.usage = ModelUsage(provider=self.provider)
        self.model = model or resolution_model(self.provider)
        self.max_calls = max_calls
        #: Requests issued, successful or not — the quantity `max_calls` bounds.
        self.attempts = 0
        self._ruleset_block = build_ruleset_block(rules)
        self._client: ModelClient | None = None
        #: `resolve` may call one proposer from several threads. Every counter
        #: above is read-modify-write, and a lost increment is a wrong number in
        #: the run's stats — or a call ceiling that lets one extra request out.
        self._lock = threading.Lock()
        #: Set by the first rate limit. From then on requests go one at a time:
        #: the provider has said how fast it wants to be asked, and fanning out
        #: anyway would spend every retry on a burst it already refused.
        self._serialized = False
        self._request_lock = threading.Lock()
        #: Set by the first failure that every later call would repeat — a
        #: rejected key, a missing permission, an unknown model, an empty
        #: credit balance. Asking again would spend the run's wall-clock
        #: collecting the same error once per conflict.
        self._halted = False

    @property
    def halted(self) -> bool:
        """Whether an unrecoverable error stopped this proposer mid-run."""
        return self._halted

    @property
    def available(self) -> bool:
        return self._client is not None

    def __call__(
        self,
        conflict: Conflict,
        origin: ConflictOrigin | None,
        labels: tuple[str, str],
    ) -> Proposal | None:
        client = self._client
        if client is None:
            return None
        #: Attempts, not successes. Counting only successes means a failing
        #: endpoint is retried once per conflict and the ceiling that exists to
        #: bound a run never trips.
        if self._ceiling_reached():
            return None
        if self._halted:
            #: Counted as an error although no request is sent. `errors` is
            #: what the console subtracts from `escalated` to find the agent's
            #: real judgements, and this conflict escalates with no answer
            #: exactly as if the doomed call had been made.
            with self._lock:
                self.usage.errors += 1
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

        for remaining in range(RATE_LIMIT_RETRIES, -1, -1):
            #: Re-checked per physical request, not just on entry. A retry is
            #: another request against the same quota, and a ceiling that only
            #: counted first tries would let a throttled run exceed the bound it
            #: exists to enforce.
            if not self._reserve_attempt():
                return None
            try:
                return self._request(client, block)
            except Exception as error:
                #: A rate limit is not an outage — it is the provider saying
                #: "later", and on a free tier it is the NORMAL response to a
                #: batch. Escalating on it would report a quota as a property of
                #: the conflict, which is how a throttled run gets written up as
                #: a result. Everything else fails on the first try, because a
                #: bad request retried is just a bad request billed twice.
                if remaining == 0 or not _is_rate_limited(error):
                    #: A failed call escalates. It never falls back to a guess —
                    #: an outage must not quietly change what the system
                    #: decides. It is recorded rather than swallowed, so the run
                    #: reports the outage.
                    with self._lock:
                        self.usage.errors += 1
                        if not self.usage.first_error:
                            self.usage.first_error = f"{type(error).__name__}: {error}"
                        if _is_unrecoverable(error):
                            self._halted = True
                    return None

                with self._lock:
                    self.usage.rate_limited += 1
                    self._serialized = True
                time.sleep(_retry_after(error))

        return None  # unreachable: the loop always returns

    def _ceiling_reached(self) -> bool:
        with self._lock:
            return self.max_calls is not None and self.attempts >= self.max_calls

    def _reserve_attempt(self) -> bool:
        """Claim one request against the ceiling, atomically.

        Check-and-increment under one lock: two threads that each checked and
        then incremented separately could both pass a ceiling with one slot
        left.
        """
        with self._lock:
            if self.max_calls is not None and self.attempts >= self.max_calls:
                return False
            self.attempts += 1
            return True

    def _request(self, client: ModelClient, block: str) -> Proposal | None:
        """One physical request — serialized once the provider has throttled us."""
        if self._serialized:
            with self._request_lock:
                return self._propose(client, block)
        return self._propose(client, block)

    def _propose(self, client: ModelClient, block: str) -> Proposal | None:
        """Issue one request and read the forced tool call back out of it.

        The client is passed in rather than read off ``self`` so the signature
        states the invariant ``__call__`` already established: this only runs
        when there is something to call.
        """
        raise NotImplementedError


class ClaudeProposer(ModelProposer):
    """``propose``, backed by Claude. Caching is explicit, on the ruleset block."""

    provider: ModelProvider = "claude"

    def __init__(
        self,
        rules: list[SurvivorshipRule],
        *,
        client: ModelClient | None = None,
        model: str | None = None,
        max_calls: int | None = None,
    ) -> None:
        super().__init__(rules, model=model, max_calls=max_calls)
        self._client = client if client is not None else _default_claude_client()

    def _propose(self, client: ModelClient, block: str) -> Proposal | None:
        message = client.messages.create(
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
            tool_choice={"type": "tool", "name": SUBMIT_RESOLUTION_NAME},
            messages=[{"role": "user", "content": block}],
        )
        self._record(message)
        return _read_claude_proposal(message)

    def _record(self, message: ModelResponse) -> None:
        usage = getattr(message, "usage", None)
        with self._lock:
            self.usage.calls += 1
            if usage is None:
                return
            self.usage.input_tokens += int(getattr(usage, "input_tokens", 0) or 0)
            self.usage.output_tokens += int(getattr(usage, "output_tokens", 0) or 0)
            self.usage.cache_read_tokens += int(
                getattr(usage, "cache_read_input_tokens", 0) or 0
            )
            self.usage.cache_write_tokens += int(
                getattr(usage, "cache_creation_input_tokens", 0) or 0
            )


class GeminiProposer(ModelProposer):
    """``propose``, backed by Gemini.

    Same three guarantees as the Claude path — forced tool call, ruleset as a
    stable prefix, no invented values — reached through a different API.

    Two differences from the Claude path are worth knowing rather than
    discovering:

    * **Caching is implicit.** Gemini has no per-block ``cache_control``; it
      matches a repeated prefix on its own. Putting the ruleset in
      ``system_instruction`` and nothing per-conflict ahead of it is what makes
      that prefix stable, so the same discipline that earns the explicit cache
      on Claude earns the implicit one here.
    * **Thinking is on by default** on 2.5 models and is billed as output.
      ``thinking_budget=0`` turns it off, for the same reason
      ``thinking={"type": "disabled"}`` does on Claude.

    The whole config is constant across a run, so it is built once in
    ``__init__`` and only ``contents`` varies per conflict.
    """

    provider: ModelProvider = "gemini"

    def __init__(
        self,
        rules: list[SurvivorshipRule],
        *,
        client: ModelClient | None = None,
        model: str | None = None,
        max_calls: int | None = None,
    ) -> None:
        super().__init__(rules, model=model, max_calls=max_calls)
        self._client = client if client is not None else _default_gemini_client()
        self._config: ModelConfig | None = (
            _gemini_config(self._ruleset_block) if self._client is not None else None
        )

    def _propose(self, client: ModelClient, block: str) -> Proposal | None:
        response = client.models.generate_content(
            model=self.model,
            contents=block,
            config=self._config,
        )
        self._record(response)
        return _read_gemini_proposal(response)

    def _record(self, response: ModelResponse) -> None:
        usage = getattr(response, "usage_metadata", None)
        with self._lock:
            self.usage.calls += 1
            if usage is None:
                return

            #: Gemini's `prompt_token_count` INCLUDES the cached tokens, where
            #: Anthropic's `input_tokens` excludes them. Subtracting here is
            #: what keeps `ModelUsage.total_tokens` — which sums all four
            #: counters — from billing the cached prefix twice on every call,
            #: and keeps the two providers' cost lines comparable in the
            #: results table.
            prompt = int(getattr(usage, "prompt_token_count", 0) or 0)
            cached = int(getattr(usage, "cached_content_token_count", 0) or 0)
            self.usage.cache_read_tokens += cached
            self.usage.input_tokens += max(prompt - cached, 0)

            #: Thoughts are billed as output and are disabled above, so this is
            #: normally zero. Counted anyway: a model revision that ignores the
            #: budget should show up as cost, not vanish from the total.
            self.usage.output_tokens += int(getattr(usage, "candidates_token_count", 0) or 0)
            self.usage.output_tokens += int(getattr(usage, "thoughts_token_count", 0) or 0)
            #: Implicit caching has no write charge, so `cache_write_tokens`
            #: stays 0.


class AzureOpenAIProposer(ModelProposer):
    """``propose``, backed by an Azure OpenAI deployment (gpt-4.1-mini).

    Spoken over the v1 API with a plain HTTP client rather than an SDK: it is
    one POST with a stable JSON shape, and the client library it would need is
    a dependency the engine does not otherwise carry. ``httpx`` is already here
    for the other two providers.

    The same three guarantees as the other providers, reached through this API:

    * **Forced tool call** — ``tool_choice`` names the function, and the
      function is ``strict``, so the service itself guarantees the arguments
      match the schema. ``parallel_tool_calls`` is off because strict schemas
      are only enforced for a single call.
    * **No hidden reasoning** — gpt-4.1-mini is not a reasoning model, so there
      is no scratchpad to switch off; the deployment is pinned to it for that
      reason.
    * **Ruleset as a stable prefix** — Azure caches a repeated prompt prefix on
      its own. The ruleset is the system message and the tool list never
      changes, so everything ahead of the conflict is byte-identical per call.

    ``temperature`` 0 for the same reason Gemini runs at 0: the same conflict
    must resolve the same way on two runs of the benchmark.
    """

    provider: ModelProvider = "azure_openai"

    def __init__(
        self,
        rules: list[SurvivorshipRule],
        *,
        client: ModelClient | None = None,
        model: str | None = None,
        max_calls: int | None = None,
    ) -> None:
        super().__init__(rules, model=model, max_calls=max_calls)
        self._client = client if client is not None else _default_azure_openai_client()
        self._tool = openai_function_tool()

    def _propose(self, client: ModelClient, block: str) -> Proposal | None:
        response = client.post(
            "chat/completions",
            json={
                #: The deployment name — see MODEL_RESOLUTION_AZURE_OPENAI.
                "model": self.model,
                "messages": [
                    {"role": "system", "content": self._ruleset_block},
                    {"role": "user", "content": block},
                ],
                "tools": [self._tool],
                "tool_choice": {
                    "type": "function",
                    "function": {"name": SUBMIT_RESOLUTION_NAME},
                },
                "parallel_tool_calls": False,
                "temperature": 0,
                "max_completion_tokens": 1024,
            },
        )
        if response.status_code >= 400:
            raise ProviderHTTPError.from_response(response)

        payload = response.json()
        self._record(payload)
        return _read_openai_proposal(payload)

    def _record(self, payload: dict[str, Any]) -> None:
        usage = payload.get("usage") or {}
        details = usage.get("prompt_tokens_details") or {}
        with self._lock:
            self.usage.calls += 1
            #: Like Gemini, `prompt_tokens` INCLUDES the cached prefix, so it is
            #: split out here — otherwise `total_tokens` would bill the ruleset
            #: twice on every cached call.
            prompt = int(usage.get("prompt_tokens") or 0)
            cached = int(details.get("cached_tokens") or 0)
            self.usage.cache_read_tokens += cached
            self.usage.input_tokens += max(prompt - cached, 0)
            self.usage.output_tokens += int(usage.get("completion_tokens") or 0)


class ProviderHTTPError(Exception):
    """A non-2xx answer from a provider spoken to over plain HTTP.

    Carries ``status_code`` so ``_is_rate_limited`` and ``_is_unrecoverable``
    classify it exactly as they classify the SDKs' own errors, and puts the
    server's advised wait in its message in the form ``_retry_after`` reads.
    The body is included because Azure explains a 400 — a content filter, a
    missing deployment — there and nowhere else.
    """

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code

    @classmethod
    def from_response(cls, response: httpx.Response) -> ProviderHTTPError:
        headers = response.headers
        retry_ms = headers.get("retry-after-ms")
        retry = (
            f"{float(retry_ms) / 1000:.1f}" if retry_ms else headers.get("retry-after")
        )
        body = response.text[:500]
        advised = f" retry-after: {retry}" if retry else ""
        return cls(response.status_code, f"HTTP {response.status_code}: {body}{advised}")


#: Every provider Canon can resolve with, by name.
PROPOSERS: dict[ModelProvider, type[ModelProposer]] = {
    "claude": ClaudeProposer,
    "gemini": GeminiProposer,
    "azure_openai": AzureOpenAIProposer,
}


def build_proposer(
    rules: list[SurvivorshipRule],
    *,
    provider: ModelProvider = "claude",
    max_calls: int | None = None,
) -> ModelProposer:
    """The proposer for a provider. Ask ``.available`` before using it.

    Always returns an instance, configured or not, so a caller can report *why*
    the agent did not run. A ``None`` here would make "no key for Gemini" and
    "this run had no work for the agent" the same observation.
    """
    return PROPOSERS[provider](rules, max_calls=max_calls)


def missing_key_message(provider: ModelProvider) -> str:
    """What to tell an operator whose chosen provider is not configured."""
    missing = missing_settings(provider) or [API_KEY_ENV[provider]]
    verb = "is" if len(missing) == 1 else "are"
    return (
        f"{' and '.join(missing)} {verb} not set in engine/.env, so the {provider} "
        f"agent cannot run. Conflicts the ruleset does not decide will escalate."
    )


def _default_claude_client() -> ModelClient | None:
    """An Anthropic client, or None when the engine has no key configured.

    None rather than an exception: the deterministic half of the pipeline is
    fully runnable without a key, and `baseline_rules` must stay runnable on a
    machine that has never been given one.
    """
    if not os.environ.get(API_KEY_ENV["claude"]):
        return None
    try:
        import anthropic
    except ImportError:
        return None
    return anthropic.Anthropic()


def _default_gemini_client() -> ModelClient | None:
    """A Gemini client, or None when the engine has no key configured.

    Same contract as the Claude one: absence degrades the run to the
    deterministic path, it never raises.
    """
    if not os.environ.get(API_KEY_ENV["gemini"]):
        return None
    try:
        from google import genai
    except ImportError:
        return None
    return genai.Client(api_key=os.environ[API_KEY_ENV["gemini"]])


def _default_azure_openai_client() -> ModelClient | None:
    """An HTTP client bound to the Azure OpenAI v1 API, or None when unconfigured.

    ``AZURE_OPENAI_ENDPOINT`` is the resource address
    (``https://<resource>.openai.azure.com/``); the v1 path is appended here so
    the setting is the value the Azure portal shows. One client per proposer,
    shared across threads — httpx's client is safe for concurrent requests and
    keeps one connection pool for the run.
    """
    endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT", "").strip()
    key = os.environ.get(API_KEY_ENV["azure_openai"], "")
    if not endpoint or not key:
        return None
    try:
        import httpx
    except ImportError:
        return None

    base = endpoint.rstrip("/")
    if not base.endswith("/openai/v1"):
        base = f"{base}/openai/v1"
    return httpx.Client(
        base_url=f"{base}/",
        headers={"api-key": key},
        timeout=httpx.Timeout(60.0, connect=10.0),
    )


def _read_openai_proposal(payload: dict[str, Any]) -> Proposal | None:
    """The forced function call's arguments, or None if there is no usable call.

    The arguments arrive as a JSON STRING, not an object. A string that does not
    parse is treated as no proposal — it escalates — rather than repaired:
    guessing at a half-formed answer is the opposite of what validate is for.
    """
    choices = payload.get("choices") or []
    if not choices:
        return None
    message = choices[0].get("message") or {}
    for call in message.get("tool_calls") or []:
        function = call.get("function") or {}
        if function.get("name") != SUBMIT_RESOLUTION_NAME:
            continue
        try:
            arguments = json.loads(function.get("arguments") or "")
        except (TypeError, ValueError):
            return None
        if isinstance(arguments, dict):
            return _proposal_from(arguments)
    return None


def _gemini_config(ruleset_block: str) -> ModelConfig:
    """The request config, built once — it is identical for every conflict."""
    from google.genai import types

    return types.GenerateContentConfig(
        system_instruction=ruleset_block,
        #: The task is a choice between two supplied values under a quoted
        #: rule. Sampling would make the same conflict resolve differently
        #: across two runs of the benchmark, which is not a property an
        #: evaluation can report numbers from.
        temperature=0.0,
        max_output_tokens=1024,
        #: `thinking_level`, not `thinking_budget`: the budget field is the
        #: legacy control and 3.5-and-newer models reject it. MINIMAL is the
        #: floor — Gemini has no true "off" on this line, but 3.5 Flash bills
        #: zero thought tokens at MINIMAL, which is the outcome that matters.
        #:
        #: This knob is model-dependent. gemini-3.7-flash rejects MINIMAL
        #: outright, so overriding CANON_GEMINI_MODEL onto it fails loudly on
        #: the first call rather than quietly billing a scratchpad — which is
        #: the right way round for a number that ends up in a results table.
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL),
        tools=[
            types.Tool(
                function_declarations=[
                    types.FunctionDeclaration(
                        name=SUBMIT_RESOLUTION_NAME,
                        description=str(SUBMIT_RESOLUTION_TOOL["description"]),
                        parameters_json_schema=gemini_parameters_json_schema(),
                    )
                ]
            )
        ],
        #: ANY forces a call rather than merely offering one. It is the exact
        #: counterpart of Claude's `tool_choice: {"type": "tool", ...}`, and it
        #: is what makes `validate` meaningful — an answer in prose could not be
        #: compared against the two observed values.
        tool_config=types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(
                mode=types.FunctionCallingConfigMode.ANY,
                allowed_function_names=[SUBMIT_RESOLUTION_NAME],
            )
        ),
        #: The SDK would otherwise try to EXECUTE the call and loop. There is
        #: nothing to execute — the "tool" is the answer's shape, not an action.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )


def _read_claude_proposal(message: ModelResponse) -> Proposal | None:
    for block in getattr(message, "content", []):
        if getattr(block, "type", None) != "tool_use":
            continue
        if getattr(block, "name", None) != SUBMIT_RESOLUTION_NAME:
            continue
        payload = getattr(block, "input", None)
        if isinstance(payload, dict):
            return _proposal_from(payload)
    return None


def _read_gemini_proposal(response: ModelResponse) -> Proposal | None:
    for call in getattr(response, "function_calls", None) or []:
        if getattr(call, "name", None) != SUBMIT_RESOLUTION_NAME:
            continue
        payload = getattr(call, "args", None)
        if isinstance(payload, dict):
            return _proposal_from(payload)
    return None


def _is_rate_limited(error: Exception) -> bool:
    """Whether a provider said "too many requests", across both SDKs.

    Duck-typed rather than matched against each SDK's exception class: the two
    spell it differently (`anthropic.RateLimitError`, `google.genai.errors
    .ClientError` with a code), importing both here would make the module fail
    to load when either is absent, and the classes are the part of an SDK most
    likely to be reorganized. The status code is the stable fact.
    """
    for attribute in ("status_code", "code"):
        if getattr(error, attribute, None) == 429:
            return True
    return "RESOURCE_EXHAUSTED" in str(error) or "429" in str(error)


#: HTTP statuses that mean the same request will fail again on every conflict:
#: the key is wrong, the key lacks access, or the model id does not exist.
_UNRECOVERABLE_STATUSES = frozenset({401, 403, 404})

#: The same verdict, for providers that report it in the body of a 400 rather
#: than in the status — Anthropic's exhausted credit balance, Gemini's invalid
#: key and permission errors.
_UNRECOVERABLE_MARKERS = ("credit balance", "API_KEY_INVALID", "PERMISSION_DENIED")


def _is_unrecoverable(error: Exception) -> bool:
    """Whether a failure is a property of the run's configuration, not the call.

    Duck-typed for the same reasons as ``_is_rate_limited``. Deliberately
    narrow: anything not listed here — a 400 on one malformed conflict, a 500, a
    timeout — fails that conflict alone and the next one is still asked.
    """
    for attribute in ("status_code", "code"):
        if getattr(error, attribute, None) in _UNRECOVERABLE_STATUSES:
            return True
    text = str(error)
    return any(marker in text for marker in _UNRECOVERABLE_MARKERS)


def _retry_after(error: Exception) -> float:
    """How long the provider asked us to wait, clamped.

    Both providers volunteer a delay — Gemini as `retryDelay: '48s'` inside the
    error payload, Anthropic as a `retry-after` header. Honouring it beats a
    fixed backoff: the server knows when the window rolls over and a guess
    either wastes time or burns another request against a quota that has not
    reset yet.
    """
    advised = re.search(r"retryDelay['\"]?\s*:\s*['\"]?(\d+(?:\.\d+)?)s", str(error))
    if advised is None:
        advised = re.search(r"retry[-_]after['\"]?\s*:\s*['\"]?(\d+(?:\.\d+)?)", str(error))

    seconds = float(advised.group(1)) if advised else DEFAULT_RETRY_SECONDS
    #: A second of headroom: retrying at the exact instant the provider named
    #: races the window boundary and spends the retry on another 429.
    return min(seconds + 1.0, MAX_RETRY_SECONDS)


def _proposal_from(payload: dict[str, Any]) -> Proposal:
    """The tool call's arguments → a Proposal. Shared by both providers.

    Coercive on purpose: the two SDKs hand back JSON with slightly different
    conventions for absent and numeric fields, and a proposal that arrives as a
    string ``"0.9"`` from one and a float from the other must not resolve
    differently. Nothing here is trusted — `validate` still runs afterwards.
    """
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
    max_concurrency: int = 1,
) -> list[Resolution]:
    """Run a batch of conflicts through the graph.

    ``skip_validate`` exists for exactly one caller: the required ablation that
    measures what the validate node is worth. It is never set in production, and
    the harness reports it as a separate system rather than folding it into the
    headline numbers.

    ``max_concurrency`` above 1 runs that many conflicts through the graph at
    once, and only matters when there is a proposer — the deterministic nodes
    are pure Python, so without a network call to overlap, threads would add
    overhead and save nothing. Each conflict's journey is independent of every
    other's, so the resolutions are identical to a serial run and come back in
    input order. The one thing concurrency could make nondeterministic is WHICH
    conflicts a call ceiling spends its budget on, so a capped proposer is the
    caller's cue to stay at 1 — the harness does exactly that.
    """
    if skip_validate:
        return [
            _resolve_without_validate(conflict, rules, _origin(conflict, origins), proposer, labels)
            for conflict in conflicts
        ]

    graph = build_graph(proposer=proposer)
    inputs: list[ResolutionState] = [
        {
            "conflict": conflict,
            "origin": _origin(conflict, origins),
            "rules": rules,
            "labels": labels,
            "proposed_value": "",
            "rationale": "",
            "confidence": 0.0,
            "applied_rule_id": None,
            "escalation_reason": "",
        }
        for conflict in conflicts
    ]

    if proposer is not None and max_concurrency > 1 and len(inputs) > 1:
        finals: list[ResolutionState] = graph.batch(
            inputs, config={"max_concurrency": max_concurrency}
        )
    else:
        finals = [graph.invoke(state) for state in inputs]

    return [
        Resolution(
            conflict_id=_conflict_id(conflict),
            proposed_value=final.get("proposed_value", ""),
            rationale=final.get("rationale", ""),
            applied_rule_id=final.get("applied_rule_id"),
            confidence=final.get("confidence", 0.0),
            status=final.get("status", "escalated"),
        )
        for conflict, final in zip(conflicts, finals, strict=True)
    ]


def _origin(
    conflict: Conflict, origins: dict[UUID, ConflictOrigin] | None
) -> ConflictOrigin | None:
    return origins.get(conflict.id) if origins and conflict.id is not None else None


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
    """ISO 8601 → an AWARE datetime, or None.

    Naive input is read as UTC, the same reading ``db._timestamp`` gives it when
    the entity row is written. Returning it naive would make ``most_recent``
    raise the moment one source stamps an offset and the other does not —
    Salesforce always sends one, and a warehouse column typed TIMESTAMP_NTZ
    never does — and that TypeError would fail the whole run rather than one
    comparison.
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _short_date(origin: ConflictOrigin | None, *, side: str) -> str:
    if origin is None:
        return "unknown"
    raw = origin.last_modified_a if side == "a" else origin.last_modified_b
    parsed = _parse_timestamp(raw)
    return parsed.date().isoformat() if parsed else (raw or "unknown")
