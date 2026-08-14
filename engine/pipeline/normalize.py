"""Raw source records → CanonicalEntity.

A pure function: no DB writes, no API calls. That is what lets the evaluation
harness run the identical code path as production.

Folding is RECORDED, NOT DESTRUCTIVE — case, whitespace, punctuation and known
legal suffixes ("Inc.", "Pvt Ltd", "GmbH") are folded into
``normalized_name``, and ``name`` keeps what the source actually said. A
cosmetic conflict is only detectable if both survive.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID, uuid5

from connectors.base import RawRecord
from pipeline.schema import CanonicalEntity, EntityType

#: Folded off the tail of a name before comparison. Recorded, never discarded.
LEGAL_SUFFIXES: tuple[str, ...] = (
    "inc",
    "llc",
    "ltd",
    "limited",
    "corp",
    "corporation",
    "co",
    "gmbh",
    "pvt",
    "pvt ltd",
    "plc",
    "sa",
    "bv",
    "ag",
)

#: Keys every source hands back at the top level. Everything else on a record is
#: an attribute — the split is declared here rather than inferred, so a source
#: that starts emitting a new column gets it carried as an attribute instead of
#: silently dropped.
RESERVED_KEYS: frozenset[str] = frozenset(
    {"externalId", "name", "parentExternalId", "lastModifiedAt"}
)

#: Namespace for deterministic entity ids. A run's entity identity has to be
#: reproducible from (source, type, external id) alone: the evaluation harness
#: never touches Postgres, so it cannot borrow the database's ``defaultRandom``,
#: and two runs over the same dataset must produce comparable ids or a manifest
#: diff means nothing.
CANON_NAMESPACE: UUID = UUID("6f9619ff-8b86-d011-b42d-00c04fc964ff")


def fold_name(name: str) -> str:
    """Case, whitespace, punctuation and legal-suffix folding.

    Deterministic and total: the same input always folds the same way, in every
    layer, or matching stops being reproducible.

    Tokens are joined with a single space rather than concatenated. That is a
    finer fold than ``eval/generate.py::_fold`` — which concatenates — so every
    pair the generator guaranteed distinct stays distinct here, and the result
    is still readable in the console and usable as a fuzzy-match input.
    """
    tokens = [
        "".join(char for char in token if char.isalnum()) for token in name.lower().split()
    ]
    tokens = [token for token in tokens if token]

    # Only ever fold a suffix off a multi-token name: an account genuinely
    # called "Co" must not fold to the empty string.
    while len(tokens) > 1 and tokens[-1] in LEGAL_SUFFIXES:
        tokens.pop()

    return " ".join(tokens)


def entity_uuid(entity: CanonicalEntity, run_id: UUID) -> UUID:
    """Stable id for an entity within a run.

    ``uuid5`` over (run, source, type, external id) rather than a random id,
    because ``detect`` keys its entity map by this value and the harness has to
    be able to rebuild the same map on a later pass without a database round
    trip.

    ``run_id`` is part of the key and not an optional extra: ``entities`` is
    per-run and its id is a primary key, so an id derived from the source and
    external id alone would collide the moment the same source was reconciled
    twice. Everything downstream inherits the scoping — a match id is derived
    from its two entity ids, and a conflict id from its match id.
    """
    key = f"{run_id}:{entity.source_id}:{entity.entity_type}:{entity.external_id}"
    return uuid5(CANON_NAMESPACE, key)


def normalize(
    records: Iterable[RawRecord],
    *,
    entity_type: EntityType,
    source_id: str,
) -> list[CanonicalEntity]:
    """Normalize one source's records of one entity type."""
    entities: list[CanonicalEntity] = []

    for record in records:
        external_id = _required_text(record, "externalId")
        name = _required_text(record, "name")

        entities.append(
            CanonicalEntity(
                external_id=external_id,
                entity_type=entity_type,
                name=name,
                normalized_name=fold_name(name),
                parent_external_id=_optional_text(record, "parentExternalId"),
                attributes={
                    key: _optional_value(value)
                    for key, value in record.items()
                    if key not in RESERVED_KEYS
                },
                last_modified_at=_optional_text(record, "lastModifiedAt"),
                source_id=source_id,
            )
        )

    return entities


def _required_text(record: RawRecord, key: str) -> str:
    """A field the pipeline cannot proceed without.

    Raised rather than defaulted: a record with no external id cannot be matched
    to anything, and silently giving it an empty one would put a phantom entity
    in the run output that no source system can account for.
    """
    value = record.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"record is missing required field {key!r}: {record!r}")
    return value


def _optional_text(record: RawRecord, key: str) -> str | None:
    value = record.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"record field {key!r} must be a string or null, got {value!r}")
    return value or None


def _optional_value(value: object) -> str | None:
    """Attributes are compared as text, so they are stored as text.

    Booleans and numbers arrive from warehouse drivers as native types; folding
    them to their string form here means ``detect`` compares one representation
    rather than guessing at two.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    return str(value)
