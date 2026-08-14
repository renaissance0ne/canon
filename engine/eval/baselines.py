"""The two baselines.

Built in Phase 2, NOT at the end, so every subsequent change to detection or
resolution is measured against them from the day it lands.

``baseline_rules`` is the one that matters: it is fuzzy matching plus the
deterministic ruleset with no model at all. If the full pipeline cannot beat it,
the agent is not earning its cost, and that is a finding worth reporting rather
than hiding.
"""

from __future__ import annotations

from uuid import UUID, uuid5

from agent.graph import resolve
from pipeline.blocking import match
from pipeline.detect import RECORD_FIELD, ConflictOrigin, Detection, detect_detailed
from pipeline.normalize import CANON_NAMESPACE, entity_uuid
from pipeline.schema import (
    CanonicalEntity,
    Conflict,
    ConflictClass,
    Resolution,
    Severity,
    SurvivorshipRule,
)

#: Baseline output never reaches Postgres — it exists to be scored against a
#: manifest in memory. A fixed run id keeps the rows self-describing without
#: implying a run row exists to join to.
EVAL_RUN_ID: UUID = uuid5(CANON_NAMESPACE, "eval:baseline")

#: Fields the floor still has to treat as structural. Without this even a
#: re-parent would score as a generic attribute difference, and the baseline
#: would be unable to reproduce the severity model at all — an unfair floor,
#: not a floor.
_STRUCTURAL_FIELDS = frozenset({"parentExternalId"})


def baseline_exact(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
) -> list[Conflict]:
    """The floor. Exact string match only; flags any inequality as a conflict."""
    return baseline_exact_detailed(side_a, side_b).conflicts


def baseline_exact_detailed(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
) -> Detection:
    """``baseline_exact``, with the provenance the harness scores against.

    The floor still has to say *which entity* each conflict is about, or it
    cannot be compared to the manifest at all — an unscoreable baseline is not a
    baseline.

    Deliberately has no normalization anywhere: records pair on identical
    external ids, values compare with ``!=`` on the raw strings, and there is no
    cosmetic class because nothing here can tell ``"ACME INC"`` from
    ``"Acme Inc."``. Every name variant the generator injects therefore lands as
    a false positive, which is exactly the cost this baseline is here to price.

    It also cannot see duplicates: a second record under a fresh id has nothing
    to match on, so it reads as an orphan.
    """
    detection = Detection()

    index_b = {(entity.entity_type, entity.external_id): entity for entity in side_b}
    index_a = {(entity.entity_type, entity.external_id): entity for entity in side_a}

    for entity_a in side_a:
        entity_b = index_b.get((entity_a.entity_type, entity_a.external_id))

        if entity_b is None:
            _record(
                detection,
                match_key=f"exact:orphan:{entity_uuid(entity_a, EVAL_RUN_ID)}",
                field=RECORD_FIELD,
                value_a=entity_a.external_id,
                value_b="",
                conflict_class="orphan",
                severity=3,
                entity_a=entity_a,
                entity_b=None,
            )
            continue

        match_key = (
            f"exact:{entity_uuid(entity_a, EVAL_RUN_ID)}"
            f":{entity_uuid(entity_b, EVAL_RUN_ID)}"
        )

        for field_name, value_a, value_b in _raw_pairs(entity_a, entity_b):
            if value_a == value_b:
                continue
            structural = field_name in _STRUCTURAL_FIELDS
            _record(
                detection,
                match_key=match_key,
                field=field_name,
                value_a=value_a,
                value_b=value_b,
                conflict_class="structural" if structural else "attribute",
                severity=4 if structural else 2,
                entity_a=entity_a,
                entity_b=entity_b,
            )

    for entity_b in side_b:
        if (entity_b.entity_type, entity_b.external_id) in index_a:
            continue
        _record(
            detection,
            match_key=f"exact:orphan:{entity_uuid(entity_b, EVAL_RUN_ID)}",
            field=RECORD_FIELD,
            value_a="",
            value_b=entity_b.external_id,
            conflict_class="orphan",
            severity=3,
            entity_a=None,
            entity_b=entity_b,
        )

    return detection


def baseline_rules(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
    rules: list[SurvivorshipRule],
) -> tuple[list[Conflict], list[Resolution]]:
    """Fuzzy matching plus the deterministic ruleset. No model.

    This is the real comparison. It shares the entire detection path with
    ``canon_full`` — same blocking, same severity model — and differs in exactly
    one place: no proposer is passed, so any conflict the ruleset does not decide
    escalates instead of reaching Claude. Whatever separates the two systems in
    the results table is therefore attributable to the agent and to nothing else.
    """
    detection, resolutions = baseline_rules_detailed(side_a, side_b, rules)
    return detection.conflicts, resolutions


def baseline_rules_detailed(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
    rules: list[SurvivorshipRule],
) -> tuple[Detection, list[Resolution]]:
    """``baseline_rules``, keeping the provenance the harness scores against."""
    matches = match(side_a, side_b, run_id=EVAL_RUN_ID)
    entities = {entity_uuid(entity, EVAL_RUN_ID): entity for entity in [*side_a, *side_b]}
    detection = detect_detailed(matches, entities, run_id=EVAL_RUN_ID)

    resolutions = resolve(
        detection.conflicts,
        rules,
        origins=detection.origins,
        proposer=None,
    )
    return detection, resolutions


def _raw_pairs(
    entity_a: CanonicalEntity, entity_b: CanonicalEntity
) -> list[tuple[str, str, str]]:
    pairs: list[tuple[str, str, str]] = [
        ("name", entity_a.name, entity_b.name),
        (
            "parentExternalId",
            entity_a.parent_external_id or "",
            entity_b.parent_external_id or "",
        ),
    ]
    for key in sorted(set(entity_a.attributes) | set(entity_b.attributes)):
        pairs.append(
            (key, entity_a.attributes.get(key) or "", entity_b.attributes.get(key) or "")
        )
    return pairs


def _record(
    detection: Detection,
    *,
    match_key: str,
    field: str,
    value_a: str,
    value_b: str,
    conflict_class: ConflictClass,
    severity: Severity,
    entity_a: CanonicalEntity | None,
    entity_b: CanonicalEntity | None,
) -> None:
    match_id = uuid5(CANON_NAMESPACE, match_key)
    conflict_id = uuid5(CANON_NAMESPACE, f"conflict:{match_id}:{field}")
    reference = entity_a or entity_b
    if reference is None:
        raise ValueError("a conflict must reference at least one entity")

    detection.conflicts.append(
        Conflict(
            id=conflict_id,
            run_id=EVAL_RUN_ID,
            match_id=match_id,
            field=field,
            value_a=value_a,
            value_b=value_b,
            conflict_class=conflict_class,
            severity=severity,
            detected_by="rule",
        )
    )
    detection.origins[conflict_id] = ConflictOrigin(
        entity_external_id=reference.external_id,
        entity_type=reference.entity_type,
        source_a_id=entity_a.source_id if entity_a else None,
        source_b_id=entity_b.source_id if entity_b else None,
        last_modified_a=entity_a.last_modified_at if entity_a else None,
        last_modified_b=entity_b.last_modified_at if entity_b else None,
    )
