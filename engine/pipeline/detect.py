"""Conflict detection and severity scoring.

Pure: ``detect(matches) -> conflicts``. No DB writes here — main.py owns those.

Severity is a defined integer the auto-apply gate reads, and it has to be
justifiable in the paper. It is set here and nowhere else.
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field as dataclass_field
from uuid import UUID, uuid5

from pipeline.normalize import CANON_NAMESPACE, fold_name
from pipeline.schema import (
    CanonicalEntity,
    Conflict,
    ConflictClass,
    EntityType,
    Match,
    MatchSignals,
    Severity,
)

#: Fields whose disagreement changes the SHAPE of the hierarchy. Rollups break.
STRUCTURAL_FIELDS: frozenset[str] = frozenset({"parentExternalId"})

#: Fields that change who owns or is credited for something.
OWNERSHIP_FIELDS: frozenset[str] = frozenset({"territory", "roleName", "ownerId"})

#: The ``field`` on a conflict about a record's EXISTENCE rather than one of its
#: columns — orphans and duplicates. Mirrors ``eval.generate.RECORD_FIELD``; a
#: real column name could collide with a real field, a sentinel cannot.
RECORD_FIELD = "__record__"

#: Compared on every match, ahead of the attribute bag, because they are the
#: two fields the severity model actually names.
_TOP_LEVEL_FIELDS: tuple[str, ...] = ("name", "parentExternalId")


@dataclass(frozen=True)
class ConflictOrigin:
    """Where a conflict came from, for callers that need more than the diff.

    ``Conflict`` is the shape the web layer reads and it deliberately carries
    only the disagreement. The resolver needs the entity's type to select a
    rule and both timestamps to apply ``most_recent``; the harness needs the
    external id to score against the manifest. Rather than widen the contract
    for two internal consumers, detection reports provenance alongside it.
    """

    entity_external_id: str
    entity_type: EntityType
    source_a_id: str | None
    source_b_id: str | None
    last_modified_a: str | None
    last_modified_b: str | None


@dataclass(frozen=True)
class Detection:
    """Conflicts plus their provenance, keyed by conflict id."""

    conflicts: list[Conflict] = dataclass_field(default_factory=list)
    origins: dict[UUID, ConflictOrigin] = dataclass_field(default_factory=dict)
    #: Self-referential rows minted for orphans, which have no real counterpart.
    #: ``conflicts.match_id`` is NOT NULL and the console's queue inner-joins
    #: through ``matches`` to both entities, so an orphan with no row there would
    #: be written and then be invisible — detected, stored, and never reviewed.
    #: Kept separate from the real matches so a caller can tell what was found
    #: from what was manufactured to satisfy a foreign key.
    orphan_matches: list[Match] = dataclass_field(default_factory=list)


def classify(field: str, value_a: str, value_b: str) -> tuple[ConflictClass, Severity]:
    """One field disagreement → its class and severity.

    * ``parentExternalId`` differs → structural, 4
    * territory / role / owner differs → attribute, 3
    * any other field differs → attribute, 2
    * values fold to the same normalized form → cosmetic, 1

    Cosmetic is tested first even though the list reads structural-first: two
    values that fold to the same form are the *same value*, differently spelled,
    whatever field they sit in. Classifying that as structural would put a
    severity 4 on ``"ACME INC"`` versus ``"Acme Inc."`` and drown the queue.
    """
    if fold_name(value_a) == fold_name(value_b):
        return "cosmetic", 1
    if field in STRUCTURAL_FIELDS:
        return "structural", 4
    if field in OWNERSHIP_FIELDS:
        return "attribute", 3
    return "attribute", 2


def severity_for_orphan(*, has_children: bool) -> Severity:
    """4 when the entity has children, 3 when it does not."""
    return 4 if has_children else 3


def detect(
    matches: list[Match],
    entities: dict[UUID, CanonicalEntity],
    *,
    run_id: UUID,
) -> list[Conflict]:
    """Field-by-field diff across every match.

    Unmatched entities on either side are recorded as ``orphan`` conflicts; two
    records on one side matching one on the other are ``duplicate``, always
    severity 4 — a duplicate silently double-counts.
    """
    return detect_detailed(matches, entities, run_id=run_id).conflicts


def detect_detailed(
    matches: list[Match],
    entities: dict[UUID, CanonicalEntity],
    *,
    run_id: UUID,
) -> Detection:
    """``detect``, with provenance retained. See ``ConflictOrigin``."""
    detection = Detection()

    duplicate_match_ids = _duplicate_matches(matches)
    matched_entity_ids: set[UUID] = set()

    for match in matches:
        entity_a = entities.get(match.entity_a_id)
        entity_b = entities.get(match.entity_b_id)
        if entity_a is None or entity_b is None:
            raise KeyError(
                f"match {match.id} references an entity absent from the run's entity map"
            )

        matched_entity_ids.add(match.entity_a_id)
        matched_entity_ids.add(match.entity_b_id)

        match_id = _match_id(match)

        if match_id in duplicate_match_ids:
            # A duplicate is a decision about which record survives, not about
            # which territory wins. Diffing its fields would emit conflicts for
            # a record that should not exist, so this pair reports once.
            _append(
                detection,
                run_id=run_id,
                match_id=match_id,
                field=RECORD_FIELD,
                value_a=entity_a.external_id,
                value_b=entity_b.external_id,
                conflict_class="duplicate",
                severity=4,
                entity_a=entity_a,
                entity_b=entity_b,
                reference=entities[duplicate_match_ids[match_id]],
            )
            continue

        for field_name, value_a, value_b in _field_pairs(entity_a, entity_b):
            if value_a == value_b:
                continue
            conflict_class, severity = classify(field_name, value_a, value_b)
            _append(
                detection,
                run_id=run_id,
                match_id=match_id,
                field=field_name,
                value_a=value_a,
                value_b=value_b,
                conflict_class=conflict_class,
                severity=severity,
                entity_a=entity_a,
                entity_b=entity_b,
            )

    _append_orphans(detection, entities, matched_entity_ids, run_id=run_id)
    return detection


# ── internals ────────────────────────────────────────────────────────────────


def _match_id(match: Match) -> UUID:
    if match.id is None:
        raise ValueError("matches must carry an id before conflicts can reference them")
    return match.id


def _duplicate_matches(matches: list[Match]) -> dict[UUID, UUID]:
    """Match id → the entity being duplicated, for links that are duplicates.

    A duplicate presents as one entity on one side appearing in more than one
    match. The strongest link (an exact external-id agreement scores 1.0) is
    taken to be the real record; every weaker link into the same entity is the
    spurious copy. Ties keep discovery order, so the result is deterministic.

    The shared entity is returned along with the match id because it — not the
    freshly minted copy — is the real-world thing the conflict is *about*. A
    reviewer asking "which account is double-counted here?" wants the id that
    exists in both systems, and a duplicate reported under the copy's own id
    would be unjoinable to anything else in the run.
    """
    by_counterpart: dict[UUID, list[Match]] = {}
    for match in matches:
        by_counterpart.setdefault(match.entity_a_id, []).append(match)
        by_counterpart.setdefault(match.entity_b_id, []).append(match)

    duplicates: dict[UUID, UUID] = {}
    for shared_entity_id, linked in by_counterpart.items():
        if len(linked) < 2:
            continue
        strongest = max(linked, key=lambda m: m.confidence)
        for match in linked:
            if match is not strongest:
                duplicates[_match_id(match)] = shared_entity_id

    return duplicates


def _field_pairs(
    entity_a: CanonicalEntity, entity_b: CanonicalEntity
) -> list[tuple[str, str, str]]:
    """Every field worth diffing, in a fixed order.

    Attribute keys are the union of both sides, sorted: a field one system
    stopped populating is a disagreement, not an absence, and iterating one
    side's keys alone would never see it.
    """
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

    assert [pair[0] for pair in pairs[: len(_TOP_LEVEL_FIELDS)]] == list(_TOP_LEVEL_FIELDS)
    return pairs


def _append_orphans(
    detection: Detection,
    entities: dict[UUID, CanonicalEntity],
    matched_entity_ids: set[UUID],
    *,
    run_id: UUID,
) -> None:
    """Entities present on one side and absent from the other.

    Severity depends on whether the entity has children, because a childless
    orphan is a missing row and an orphan with children is a hierarchy with a
    hole in it — the rollups below it have nowhere to land.
    """
    children = _children_counts(entities)
    sides = _side_ids(entities)

    for entity_id, entity in entities.items():
        if entity_id in matched_entity_ids:
            continue

        on_side_a = entity.source_id == sides[0]
        has_children = children.get((entity.source_id, entity.external_id), 0) > 0

        #: An orphan has no match by definition, but the schema requires one and
        #: the console reaches both entity rows through it. The row is
        #: self-referential and labelled `orphan` so nothing downstream mistakes
        #: it for a pairing; confidence 0 says the same thing numerically.
        match_id = uuid5(CANON_NAMESPACE, f"orphan:{entity_id}")
        detection.orphan_matches.append(
            Match(
                id=match_id,
                run_id=run_id,
                entity_a_id=entity_id,
                entity_b_id=entity_id,
                confidence=0.0,
                method="orphan",
                signals=MatchSignals(exact_key=False, cosine=0.0, fuzzy_ratio=0.0),
            )
        )

        _append(
            detection,
            run_id=run_id,
            match_id=match_id,
            field=RECORD_FIELD,
            value_a=entity.external_id if on_side_a else "",
            value_b="" if on_side_a else entity.external_id,
            conflict_class="orphan",
            severity=severity_for_orphan(has_children=has_children),
            entity_a=entity if on_side_a else None,
            entity_b=None if on_side_a else entity,
        )


def _children_counts(entities: dict[UUID, CanonicalEntity]) -> dict[tuple[str, str], int]:
    """(source, parent external id) → child count, within that source only.

    Scoped per source because "has children" is a statement about the hierarchy
    the entity actually lives in; borrowing the other side's children would make
    an orphan's severity depend on the system it is missing from.
    """
    counts: dict[tuple[str, str], int] = {}
    for entity in entities.values():
        if entity.parent_external_id is None:
            continue
        key = (entity.source_id, entity.parent_external_id)
        counts[key] = counts.get(key, 0) + 1
    return counts


def _side_ids(entities: dict[UUID, CanonicalEntity]) -> tuple[str | None, str | None]:
    """(source A id, source B id), in first-seen order.

    First-seen rather than sorted: side A is whichever source the run extracted
    first, and the console labels the columns from the same ordering.
    """
    seen: list[str] = []
    for entity in entities.values():
        if entity.source_id not in seen:
            seen.append(entity.source_id)
        if len(seen) == 2:
            break
    return (
        seen[0] if seen else None,
        seen[1] if len(seen) > 1 else None,
    )


def _append(
    detection: Detection,
    *,
    run_id: UUID,
    match_id: UUID,
    field: str,
    value_a: str,
    value_b: str,
    conflict_class: ConflictClass,
    severity: Severity,
    entity_a: CanonicalEntity | None,
    entity_b: CanonicalEntity | None,
    reference: CanonicalEntity | None = None,
) -> None:
    conflict_id = uuid5(CANON_NAMESPACE, f"conflict:{match_id}:{field}")
    reference = reference or entity_a or entity_b
    if reference is None:
        raise ValueError("a conflict must reference at least one entity")

    detection.conflicts.append(
        Conflict(
            id=conflict_id,
            run_id=run_id,
            match_id=match_id,
            field=field,
            value_a=value_a,
            value_b=value_b,
            conflict_class=conflict_class,
            severity=severity,
            #: Every conflict here came from the deterministic differ. The agent
            #: proposes resolutions; it does not detect.
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
