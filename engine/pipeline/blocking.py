"""Candidate generation, then matching.

Blocking exists so the pipeline is O(n·k), not O(n²). NEVER compare all pairs —
that is the difference between a 500-account demo and a 50,000-account org.

Order matters: exact key first (external id, then domain, then normalized
name), and only what is left over goes through embeddings.
"""

from __future__ import annotations

import functools
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from functools import partial
from typing import Any
from uuid import UUID, uuid5

from rapidfuzz import fuzz, process

from pipeline.normalize import CANON_NAMESPACE, entity_uuid
from pipeline.schema import CanonicalEntity, EntityType, Match, MatchMethod, MatchSignals

#: Neighbours retrieved per unmatched entity from the FAISS index.
TOP_K = 10

#: Below this, a candidate pair is not worth scoring.
MIN_MATCH_CONFIDENCE = 0.50

#: A pair with no external-id agreement has only its name as evidence, so the
#: bar is near-identity. Set low, this is the single largest source of false
#: matches in the whole pipeline: two real accounts called "Northwind Traders"
#: and "Northwind Systems" score around 0.62 on a token ratio, and believing
#: that pair would both invent a page of field conflicts and destroy the orphan
#: detection for the record that genuinely has no counterpart.
MIN_NAME_MATCH_CONFIDENCE = 0.92

#: Weights for the lexical and semantic signals when no exact key agreed. They
#: are named because eval/ sweeps them: a magic 0.55 buried in an expression is
#: a number nobody can defend in the results chapter.
FUZZY_WEIGHT = 0.55
COSINE_WEIGHT = 0.45

#: Small, fast, and good enough for company and person names — the blocking
#: stage only has to get the true pair into the top k, not rank it first.
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

#: Fuzzy floor for a name-only candidate. Below this the pair is noise and
#: scoring it wastes the budget blocking exists to protect.
_FUZZY_CANDIDATE_FLOOR = 70.0


@dataclass(frozen=True)
class Candidate:
    """A pair worth scoring, and how it was found.

    The provenance is carried rather than re-derived because it is what
    ``method`` on the written match reports, and the evaluation splits results
    by it — "exact key handled 94%" is a finding, not a footnote.
    """

    a: CanonicalEntity
    b: CanonicalEntity
    method: MatchMethod
    cosine: float


def block(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
    *,
    run_id: UUID,
    top_k: int = TOP_K,
) -> list[tuple[CanonicalEntity, CanonicalEntity]]:
    """Candidate pairs only — exact key first, then embedding top-k."""
    return [
        (candidate.a, candidate.b)
        for candidate in candidates(side_a, side_b, run_id=run_id, top_k=top_k)
    ]


def candidates(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
    *,
    run_id: UUID,
    top_k: int = TOP_K,
) -> list[Candidate]:
    """Blocking, with provenance and the semantic score retained.

    Three passes, cheapest first, and each pass only looks at what the previous
    one left over:

    1. **exact external id** — the same record in both systems;
    2. **exact normalized name** — the same real-world thing under two ids,
       which is how a duplicate presents itself;
    3. **embedding top-k** — everything else, bounded to k neighbours.

    An entity resolved in pass 1 is still available as a *counterpart* in later
    passes. That is deliberate: a duplicate is precisely two records on one side
    pointing at one record on the other, and excluding already-paired records
    from the candidate pool would make duplicates undetectable by construction.
    """
    found: list[Candidate] = []
    seen: set[tuple[UUID, UUID]] = set()
    key_of = partial(entity_uuid, run_id=run_id)

    for entity_type in _entity_types(side_a, side_b):
        group_a = [entity for entity in side_a if entity.entity_type == entity_type]
        group_b = [entity for entity in side_b if entity.entity_type == entity_type]

        matched_a: set[str] = set()
        matched_b: set[str] = set()

        # ── pass 1: exact external id ────────────────────────────────────────
        by_external_id = {entity.external_id: entity for entity in group_b}
        for entity in group_a:
            counterpart = by_external_id.get(entity.external_id)
            if counterpart is not None:
                _add(found, seen, key_of, Candidate(entity, counterpart, "exact_key", 1.0))
                matched_a.add(entity.external_id)
                matched_b.add(counterpart.external_id)

        # ── pass 2: exact normalized name ────────────────────────────────────
        leftover_a = [e for e in group_a if e.external_id not in matched_a]
        leftover_b = [e for e in group_b if e.external_id not in matched_b]

        by_name_b = _index_by_name(group_b)
        by_name_a = _index_by_name(group_a)

        for entity in leftover_a:
            for counterpart in by_name_b.get(entity.normalized_name, ()):
                _add(found, seen, key_of, Candidate(entity, counterpart, "fuzzy", 1.0))
                matched_a.add(entity.external_id)
        for entity in leftover_b:
            for counterpart in by_name_a.get(entity.normalized_name, ()):
                _add(found, seen, key_of, Candidate(counterpart, entity, "fuzzy", 1.0))
                matched_b.add(entity.external_id)

        # ── pass 3: embedding top-k over what is still unresolved ────────────
        remaining_a = [e for e in group_a if e.external_id not in matched_a]
        remaining_b = [e for e in group_b if e.external_id not in matched_b]

        for candidate in _neighbours(remaining_a, group_b, top_k=top_k):
            _add(found, seen, key_of, candidate)
        for candidate in _neighbours(remaining_b, group_a, top_k=top_k):
            _add(
                found,
                seen,
                key_of,
                Candidate(candidate.b, candidate.a, candidate.method, candidate.cosine),
            )

    return found


def score(a: CanonicalEntity, b: CanonicalEntity, *, cosine: float = 0.0) -> MatchSignals:
    """RapidFuzz ratio, cosine similarity and exact-key agreement.

    ``cosine`` is supplied by the blocking pass that produced the pair rather
    than recomputed here: embedding a pair on demand would put a model call
    inside a function the harness runs hundreds of thousands of times.
    """
    return MatchSignals(
        exact_key=a.external_id == b.external_id,
        cosine=cosine,
        fuzzy_ratio=fuzz.token_sort_ratio(a.normalized_name, b.normalized_name) / 100.0,
    )


def combine(signals: MatchSignals) -> float:
    """Signals → one confidence in 0..1. The weights are swept by eval/.

    An exact external-id agreement is identity, not evidence — it short-circuits
    to 1.0 rather than being averaged down by a name that happens to have been
    edited on one side.

    When no embedding backend is available ``cosine`` is 0.0, and the lexical
    signal stands alone rather than being halved by a semantic score that was
    never computed. That is a documented degradation, not a silent one: the
    harness reports which backend produced a run's numbers.
    """
    if signals.exact_key:
        return 1.0
    if signals.cosine <= 0.0:
        return signals.fuzzy_ratio
    return FUZZY_WEIGHT * signals.fuzzy_ratio + COSINE_WEIGHT * signals.cosine


def match(
    side_a: list[CanonicalEntity],
    side_b: list[CanonicalEntity],
    *,
    run_id: UUID,
    top_k: int = TOP_K,
) -> list[Match]:
    """Full blocking + scoring pass. Pure: writes nothing."""
    return score_candidates(
        candidates(side_a, side_b, run_id=run_id, top_k=top_k), run_id=run_id
    )


def score_candidates(found: list[Candidate], *, run_id: UUID) -> list[Match]:
    """Score pairs that blocking already produced.

    Split out from ``match`` so a caller that needs the candidate count for its
    run statistics — the console reports it — can generate once and score once.
    Calling ``candidates`` a second time just to count would re-run the
    embedding pass, which is the most expensive thing in the stage.
    """
    matches: list[Match] = []

    for candidate in found:
        signals = score(candidate.a, candidate.b, cosine=candidate.cosine)
        confidence = combine(signals)

        floor = MIN_MATCH_CONFIDENCE if signals.exact_key else MIN_NAME_MATCH_CONFIDENCE
        if confidence < floor:
            continue

        entity_a_id = entity_uuid(candidate.a, run_id)
        entity_b_id = entity_uuid(candidate.b, run_id)

        matches.append(
            Match(
                #: Deterministic, so a conflict can name its match without a
                #: database round trip and two runs over one dataset are
                #: comparable row for row.
                id=uuid5(CANON_NAMESPACE, f"match:{entity_a_id}:{entity_b_id}"),
                run_id=run_id,
                entity_a_id=entity_a_id,
                entity_b_id=entity_b_id,
                confidence=confidence,
                method=candidate.method,
                signals=signals,
            )
        )

    return matches


# ── internals ────────────────────────────────────────────────────────────────


def _entity_types(
    side_a: Iterable[CanonicalEntity], side_b: Iterable[CanonicalEntity]
) -> list[EntityType]:
    """Entity types present, in a fixed order.

    Fixed rather than set-ordered because candidate order decides match order,
    match order decides conflict order, and a run whose output permutes between
    invocations is not reproducible.
    """
    order: list[EntityType] = ["account", "user", "role", "territory"]
    present = {entity.entity_type for entity in side_a} | {
        entity.entity_type for entity in side_b
    }
    return [entity_type for entity_type in order if entity_type in present]


def _index_by_name(entities: list[CanonicalEntity]) -> dict[str, list[CanonicalEntity]]:
    index: dict[str, list[CanonicalEntity]] = {}
    for entity in entities:
        index.setdefault(entity.normalized_name, []).append(entity)
    return index


def _add(
    found: list[Candidate],
    seen: set[tuple[UUID, UUID]],
    key_of: Callable[[CanonicalEntity], UUID],
    candidate: Candidate,
) -> None:
    """Append unless the pair is already present.

    Keyed on entity ids rather than on the pair object so a pair discovered by
    two different passes is recorded once, under the first (cheapest, most
    trustworthy) method that found it.
    """
    if candidate.a.external_id == candidate.b.external_id and candidate.method != "exact_key":
        return

    key = (key_of(candidate.a), key_of(candidate.b))
    if key in seen:
        return

    seen.add(key)
    found.append(candidate)


def _neighbours(
    queries: list[CanonicalEntity],
    pool: list[CanonicalEntity],
    *,
    top_k: int,
) -> list[Candidate]:
    """Top-k nearest neighbours for each query, embeddings first."""
    if not queries or not pool:
        return []

    embedded = _embedding_neighbours(queries, pool, top_k=top_k)
    if embedded is not None:
        return embedded

    return _fuzzy_neighbours(queries, pool, top_k=top_k)


def _embedding_neighbours(
    queries: list[CanonicalEntity],
    pool: list[CanonicalEntity],
    *,
    top_k: int,
) -> list[Candidate] | None:
    """FAISS inner-product search over normalized embeddings.

    Returns ``None`` — rather than raising — when the model or index cannot be
    loaded, so a machine with no cached model weights still produces a complete
    run through the lexical path. Which backend ran is reported by the harness;
    it is never inferred from the numbers.
    """
    try:
        import faiss
        import numpy as np
    except Exception:
        return None

    model = _load_encoder()
    if model is None:
        return None

    try:
        pool_vectors = model.encode(
            [entity.normalized_name for entity in pool],
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        query_vectors = model.encode(
            [entity.normalized_name for entity in queries],
            normalize_embeddings=True,
            show_progress_bar=False,
        )
    except Exception:
        return None

    pool_array: Any = np.asarray(pool_vectors, dtype="float32")
    query_array: Any = np.asarray(query_vectors, dtype="float32")

    # Vectors are L2-normalized, so inner product *is* cosine similarity.
    index = faiss.IndexFlatIP(pool_array.shape[1])
    index.add(pool_array)
    scores, positions = index.search(query_array, min(top_k, len(pool)))

    found: list[Candidate] = []
    for query_position, entity in enumerate(queries):
        for rank in range(positions.shape[1]):
            pool_position = int(positions[query_position][rank])
            if pool_position < 0:
                continue
            found.append(
                Candidate(
                    a=entity,
                    b=pool[pool_position],
                    method="embedding",
                    cosine=float(scores[query_position][rank]),
                )
            )
    return found


#: sentence-transformers ships no type information (see the mypy overrides in
#: pyproject.toml), so the encoder is opaque to the checker. Named rather than
#: an inline `Any` so the reason travels with it.
Encoder = Any


@functools.lru_cache(maxsize=1)
def _load_encoder() -> Encoder | None:
    """Load the sentence encoder once per process.

    Cached because blocking runs per entity type and the harness runs several
    systems over the same data: without this the weights are re-read from disk
    a dozen times per invocation, which dominates the runtime of a stage whose
    entire purpose is to be cheap.
    """
    try:
        from sentence_transformers import SentenceTransformer

        return SentenceTransformer(EMBEDDING_MODEL)
    except Exception:
        return None


def _fuzzy_neighbours(
    queries: list[CanonicalEntity],
    pool: list[CanonicalEntity],
    *,
    top_k: int,
) -> list[Candidate]:
    """The lexical fallback: RapidFuzz top-k over normalized names."""
    pool_names = [entity.normalized_name for entity in pool]

    found: list[Candidate] = []
    for entity in queries:
        for _, _similarity, pool_position in process.extract(
            entity.normalized_name,
            pool_names,
            scorer=fuzz.token_sort_ratio,
            limit=top_k,
            score_cutoff=_FUZZY_CANDIDATE_FLOOR,
        ):
            found.append(
                Candidate(
                    a=entity,
                    b=pool[pool_position],
                    method="fuzzy",
                    #: No semantic signal was computed. Saying 0.0 keeps
                    #: `combine` honest about what it actually had.
                    cosine=0.0,
                )
            )
    return found
