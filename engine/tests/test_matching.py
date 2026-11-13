"""Matching, folding and resolution invariants that the benchmark relies on.

Each test pins one behaviour a regression would silently change the reported
numbers through. They run without the embedding model or a database.
"""

from __future__ import annotations

import threading
import time
from uuid import uuid4

import pytest

from agent.graph import (
    ModelProposer,
    Proposal,
    _parse_timestamp,
    apply_rule,
    resolve,
)
from pipeline.blocking import (
    MIN_NAME_MATCH_CONFIDENCE,
    combine,
    field_agreement,
    identifying_numbers_disagree,
    name_match_fuzzy_floor,
    score,
)
from pipeline.detect import ConflictOrigin
from pipeline.normalize import fold_name
from pipeline.schema import (
    CanonicalEntity,
    Conflict,
    MatchSignals,
    ModelProvider,
    SurvivorshipRule,
)


def entity(
    external_id: str,
    name: str,
    *,
    parent: str | None = "ACC-1",
    source: str = "crm",
    **attributes: str | None,
) -> CanonicalEntity:
    return CanonicalEntity(
        external_id=external_id,
        entity_type="account",
        name=name,
        normalized_name=fold_name(name),
        parent_external_id=parent,
        attributes=attributes,
        source_id=source,
    )


# ── folding ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("Acme Inc.", "ACME INC"),
        ("Acme Pvt Ltd", "Acme Private Limited"),
        ("Société Générale", "Societe Generale"),
        ("Johnson & Johnson", "Johnson and Johnson"),
        ("AT&T", "ATT"),
        ("Contoso Company", "Contoso"),
    ],
)
def test_representation_differences_fold_together(a: str, b: str) -> None:
    assert fold_name(a) == fold_name(b)


def test_a_name_that_is_only_a_suffix_is_kept() -> None:
    assert fold_name("Co") == "co"


# ── match evidence ───────────────────────────────────────────────────────────


def test_field_agreement_counts_only_fields_both_sides_populate() -> None:
    a = entity("A", "Northwind", territory="EMEA", segment="SMB", industry=None)
    b = entity("B", "Northwind", territory="EMEA", segment="Enterprise", industry="Retail")
    # parent agrees, territory agrees, segment disagrees; industry is not comparable
    assert field_agreement(a, b) == pytest.approx(2 / 3)


def test_field_agreement_is_unknown_with_too_little_to_compare() -> None:
    a = entity("A", "Northwind", parent=None, territory="EMEA")
    b = entity("B", "Northwind", parent=None, territory="APAC")
    assert field_agreement(a, b) is None


def test_field_agreement_folds_values() -> None:
    a = entity("A", "N", territory="APAC-South", segment="SMB")
    b = entity("B", "N", territory="apac-south ", segment="smb")
    assert field_agreement(a, b) == 1.0


def test_numbered_siblings_are_different_entities() -> None:
    a = entity("A", "Northwind Foods Midwest 791 Ltd")
    b = entity("B", "Northwind Foods Midwest 1631 GmbH")
    assert identifying_numbers_disagree(a, b)
    # A number on one side only is left to the rest of the evidence.
    assert not identifying_numbers_disagree(entity("A", "Acme 2019"), entity("B", "Acme"))


def test_similar_name_with_disagreeing_fields_does_not_match() -> None:
    a = entity("A", "Proseware Foods West", parent="P1", territory="EMEA-S", ownerId="U1")
    b = entity("B", "Proseware Food West", parent="P2", territory="AMER-S", ownerId="U2")
    signals = score(a, b, cosine=0.96)
    assert combine(signals) < MIN_NAME_MATCH_CONFIDENCE


def test_exact_key_is_identity_whatever_else_disagrees() -> None:
    signals = MatchSignals(exact_key=True, cosine=0.0, fuzzy_ratio=0.1, field_agreement=0.0)
    assert combine(signals) == 1.0


def test_canopy_floor_is_lossless() -> None:
    """No pair under the floor can reach the match bar, even with perfect support."""
    just_under = name_match_fuzzy_floor() - 0.001
    for agreement in (None, 1.0):
        signals = MatchSignals(
            exact_key=False, cosine=1.0, fuzzy_ratio=just_under, field_agreement=agreement
        )
        assert combine(signals) < MIN_NAME_MATCH_CONFIDENCE


# ── resolution ───────────────────────────────────────────────────────────────


def test_naive_and_aware_timestamps_compare() -> None:
    rule = SurvivorshipRule(
        id="r", field="territory", entity_type="*", strategy="most_recent", description="d"
    )
    conflict = Conflict(
        id=uuid4(),
        run_id=uuid4(),
        match_id=uuid4(),
        field="territory",
        value_a="APAC",
        value_b="EMEA",
        conflict_class="attribute",
        severity=3,
        detected_by="rule",
    )
    origin = ConflictOrigin(
        entity_external_id="ACC-1",
        entity_type="account",
        source_a_id="crm",
        source_b_id="warehouse",
        last_modified_a="2026-01-02T00:00:00+00:00",
        last_modified_b="2026-01-01T00:00:00",  # naive: read as UTC
    )
    decision = apply_rule(rule, conflict, origin)
    assert decision is not None and decision.value == "APAC"
    assert _parse_timestamp("2026-01-01T00:00:00") is not None


class _SlowProposer(ModelProposer):
    """A stand-in provider that records how many requests overlap."""

    provider: ModelProvider = "claude"

    def __init__(self) -> None:
        super().__init__([], model="test")
        self._client = object()
        self.in_flight = 0
        self.peak = 0
        self._gauge = threading.Lock()

    def _propose(self, client: object, block: str) -> Proposal | None:
        with self._gauge:
            self.in_flight += 1
            self.peak = max(self.peak, self.in_flight)
        time.sleep(0.05)
        with self._gauge:
            self.in_flight -= 1
        with self._lock:
            self.usage.calls += 1
        return Proposal(proposed_value="", rationale="", confidence=0.0, applied_rule_id=None)


def _conflicts(count: int) -> list[Conflict]:
    run, match = uuid4(), uuid4()
    return [
        Conflict(
            id=uuid4(),
            run_id=run,
            match_id=match,
            field="segment",
            value_a=f"a{index}",
            value_b=f"b{index}",
            conflict_class="attribute",
            severity=2,
            detected_by="rule",
        )
        for index in range(count)
    ]


def test_concurrent_resolution_overlaps_calls_and_keeps_order() -> None:
    proposer = _SlowProposer()
    conflicts = _conflicts(8)

    resolutions = resolve(conflicts, [], proposer=proposer, max_concurrency=4)

    assert [r.conflict_id for r in resolutions] == [c.id for c in conflicts]
    assert proposer.usage.calls == 8
    assert proposer.peak > 1


class _RejectedKeyError(Exception):
    status_code = 401


class _BrokenProposer(_SlowProposer):
    """Every request fails the way a revoked key does."""

    def __init__(self) -> None:
        super().__init__()
        self.requests = 0

    def _propose(self, client: object, block: str) -> Proposal | None:
        with self._lock:
            self.requests += 1
        raise _RejectedKeyError("invalid x-api-key")


def test_unrecoverable_error_stops_further_requests() -> None:
    proposer = _BrokenProposer()

    resolutions = resolve(_conflicts(6), [], proposer=proposer)

    assert proposer.requests == 1
    # Every conflict is still counted as unanswered, so the console's
    # `escalated - modelErrors` arithmetic stays true.
    assert proposer.usage.errors == 6
    assert proposer.halted
    assert all(r.status == "escalated" for r in resolutions)


def test_call_ceiling_holds_under_concurrency() -> None:
    proposer = _SlowProposer()
    proposer.max_calls = 3

    resolve(_conflicts(10), [], proposer=proposer, max_concurrency=4)

    assert proposer.attempts == 3
    assert proposer.usage.calls == 3
