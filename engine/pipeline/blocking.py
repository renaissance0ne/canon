"""Candidate generation, then matching.

Blocking exists so the pipeline is O(n·k), not O(n²). NEVER compare all pairs —
that is the difference between a 500-account demo and a 50,000-account org.

Order matters: exact key first (external id, then domain, then normalized
name), and only what is left over goes through embeddings.

Two kinds of evidence decide a match that no exact key settles:

* **the name** — RapidFuzz and cosine similarity over the folded name;
* **the fields** — how many of the fields both records populate agree. A name
  is a label two companies can share; a parent, a territory, an owner and a
  segment all agreeing is what makes two records the same account. AGENTS.md
  names this signal ("RapidFuzz + cosine + field-agreement signals combine
  into a confidence"), and without it the matcher pairs any orphan with the
  nearest similarly-named stranger — which turns a missing record into a false
  duplicate and invents a page of field conflicts besides.

One identity check sits outside the confidence entirely: names that differ in
an identifying number ("Store 101" / "Store 102", "Northwind Foods 791" /
"Northwind Foods 1631") are different entities, however well everything else
lines up. Sibling stores share a parent, a territory and an owner, so field
agreement cannot catch them; the number is the one token that says which is
which.
"""

from __future__ import annotations

import functools
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from functools import partial
from typing import Any
from uuid import UUID, uuid5

from rapidfuzz import fuzz, process

from pipeline.normalize import CANON_NAMESPACE, entity_uuid, fold_name
from pipeline.schema import CanonicalEntity, EntityType, Match, MatchMethod, MatchSignals

#: Neighbours retrieved per unmatched entity from the FAISS index.
TOP_K = 10

#: Below this, a candidate pair is not worth scoring.
MIN_MATCH_CONFIDENCE = 0.50

#: A pair with no external-id agreement has only its name and its fields as
#: evidence, so the bar is near-identity. Set low, this is the single largest
#: source of false matches in the whole pipeline: two real accounts called
#: "Northwind Traders" and "Northwind Systems" score around 0.62 on a token
#: ratio, and believing that pair would both invent a page of field conflicts
#: and destroy the orphan detection for the record that genuinely has no
#: counterpart.
MIN_NAME_MATCH_CONFIDENCE = 0.92

#: Weights for the lexical and semantic signals within the NAME score. They are
#: named because eval/ sweeps them: a magic 0.55 buried in an expression is a
#: number nobody can defend in the results chapter.
FUZZY_WEIGHT = 0.55
COSINE_WEIGHT = 0.45

#: How the name score and field agreement combine when agreement is known.
#:
#: Agreement is the minority weight on purpose. It is there to separate two
#: similarly-named records, not to pair two differently-named ones — at 0.2 a
#: perfect agreement can lift a name score of 0.90 over the 0.92 bar, and no
#: amount of agreement rescues a name below that. Conversely an exact
#: normalized-name pair needs at least 60% of its shared fields to agree, which
#: is what stops "ABC Plumbing" in two different cities from being called a
#: duplicate.
NAME_EVIDENCE_WEIGHT = 0.80
FIELD_AGREEMENT_WEIGHT = 0.20

#: Fewer comparable fields than this and agreement is not evidence. One shared
#: field agreeing is a coin flip on a four-value segment column.
MIN_COMPARABLE_FIELDS = 2

#: Small, fast, and good enough for company and person names — the blocking
#: stage only has to get the true pair into the top k, not rank it first.
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

#: Names per forward pass. Measured on CPU: 128 encodes ~1.5x faster than the
#: library default of 32, and larger batches gain nothing further.
EMBEDDING_BATCH_SIZE = 128

#: Vectors kept per process, keyed by folded name. A rerun over the same
#: sources — the harness scores four systems over one dataset, and the console
#: re-runs a pair of sources under a new ruleset — then skips the encoder
#: entirely. Bounded because the engine is long-lived: 384 floats a name puts
#: the ceiling near 75 MB, and the cache is simply dropped when it would pass it.
_VECTOR_CACHE_LIMIT = 50_000

#: Fuzzy floor for a name-only candidate in the lexical fallback. Below this the
#: pair is noise and scoring it wastes the budget blocking exists to protect.
_FUZZY_CANDIDATE_FLOOR = 70.0

#: Cells per `cdist` block in the lexical canopy — bounds its memory at ~20 MB
#: however large the two sides get.
_CANOPY_BLOCK_CELLS = 20_000_000


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
    """RapidFuzz ratio, cosine similarity, exact-key and field agreement.

    ``cosine`` is supplied by the blocking pass that produced the pair rather
    than recomputed here: embedding a pair on demand would put a model call
    inside a function the harness runs hundreds of thousands of times.
    """
    return MatchSignals(
        exact_key=a.external_id == b.external_id,
        cosine=cosine,
        fuzzy_ratio=fuzz.token_sort_ratio(a.normalized_name, b.normalized_name) / 100.0,
        field_agreement=field_agreement(a, b),
    )


def field_agreement(a: CanonicalEntity, b: CanonicalEntity) -> float | None:
    """Of the fields both records populate, the fraction that agree.

    Only fields present on BOTH sides count. A field one system leaves empty is
    a disagreement for ``detect`` to report, but it is not evidence that the two
    records are different things — a warehouse that never loaded ``industry``
    has said nothing about which account a row is.

    Values compare after the same fold detection uses, so a territory spelled
    "APAC-South" on one side and "apac-south" on the other agrees here exactly
    as it would be classified cosmetic there.

    The name is excluded: it is the other half of the evidence, scored
    separately, and counting it twice would let a shared label outvote every
    field that says otherwise.
    """
    pairs: list[tuple[str, str]] = []
    if a.parent_external_id and b.parent_external_id:
        pairs.append((a.parent_external_id, b.parent_external_id))

    for key in sorted(a.attributes.keys() & b.attributes.keys()):
        value_a = a.attributes[key]
        value_b = b.attributes[key]
        if value_a and value_b:
            pairs.append((value_a, value_b))

    if len(pairs) < MIN_COMPARABLE_FIELDS:
        return None

    agreeing = sum(
        1
        for value_a, value_b in pairs
        if value_a == value_b or fold_name(value_a) == fold_name(value_b)
    )
    return agreeing / len(pairs)


def identifying_numbers_disagree(a: CanonicalEntity, b: CanonicalEntity) -> bool:
    """Whether both names carry numbers, and not the same ones.

    "Store 101" and "Store 102" are one character apart and score 0.97 on any
    string metric; they are also two stores. A number in a name is almost
    always the part that identifies it — a store, a branch, a region, a
    franchise — so two names whose numeric tokens differ are treated as naming
    different things.

    Only when BOTH carry one. "Acme Holdings 2019" against "Acme Holdings" is a
    renamed or annotated record as often as it is a different one, and that
    call is left to the rest of the evidence.
    """
    numbers_a = _numeric_tokens(a.normalized_name)
    numbers_b = _numeric_tokens(b.normalized_name)
    return bool(numbers_a) and bool(numbers_b) and numbers_a != numbers_b


def name_score(signals: MatchSignals) -> float:
    """The lexical and semantic evidence alone, in 0..1.

    When no embedding backend is available ``cosine`` is 0.0, and the lexical
    signal stands alone rather than being halved by a semantic score that was
    never computed. That is a documented degradation, not a silent one: the
    harness reports which backend produced a run's numbers.
    """
    if signals.cosine <= 0.0:
        return signals.fuzzy_ratio
    return FUZZY_WEIGHT * signals.fuzzy_ratio + COSINE_WEIGHT * signals.cosine


def combine(signals: MatchSignals) -> float:
    """Signals → one confidence in 0..1. The weights are swept by eval/.

    An exact external-id agreement is identity, not evidence — it short-circuits
    to 1.0 rather than being averaged down by a name that happens to have been
    edited on one side.

    Otherwise the name score stands alone when field agreement is unknown, and
    blends with it when it is known. See ``NAME_EVIDENCE_WEIGHT``.
    """
    if signals.exact_key:
        return 1.0
    name = name_score(signals)
    if signals.field_agreement is None:
        return name
    return NAME_EVIDENCE_WEIGHT * name + FIELD_AGREEMENT_WEIGHT * signals.field_agreement


def name_match_fuzzy_floor() -> float:
    """The lowest fuzzy ratio at which a name-only pair can still be matched.

    Assumes everything else is perfect — cosine 1.0 and every field agreeing —
    so ANY pair below this ratio fails ``MIN_NAME_MATCH_CONFIDENCE`` whatever
    its other signals. That is what makes the lexical canopy lossless: pruning
    below this floor removes only pairs ``score_candidates`` would reject.

    Derived from the constants rather than restated, because eval/ sweeps them
    and a floor that did not move with them would silently start discarding
    pairs the swept weights would have accepted.
    """
    # Best case with known agreement: NAME * (FUZZY*f + COSINE) + AGREEMENT >= MIN
    with_agreement = (
        (MIN_NAME_MATCH_CONFIDENCE - FIELD_AGREEMENT_WEIGHT) / NAME_EVIDENCE_WEIGHT
        - COSINE_WEIGHT
    ) / FUZZY_WEIGHT
    # Best case with agreement unknown: FUZZY*f + COSINE >= MIN
    without_agreement = (MIN_NAME_MATCH_CONFIDENCE - COSINE_WEIGHT) / FUZZY_WEIGHT
    floor = min(with_agreement, without_agreement)
    # A hair under, so float rounding at the boundary never prunes a pair the
    # scorer would have accepted.
    return min(max(floor - 0.005, 0.0), 1.0)


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

        if not signals.exact_key and identifying_numbers_disagree(candidate.a, candidate.b):
            continue

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


def warm_encoder() -> bool:
    """Load the sentence encoder now rather than on the first run's match stage.

    Called from a background thread at engine startup. Returns whether an
    encoder is available, which is all a caller needs to log.
    """
    return _encoder() is not None


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


def _numeric_tokens(normalized_name: str) -> frozenset[str]:
    return frozenset(token for token in normalized_name.split() if any(c.isdigit() for c in token))


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
    """Top-k nearest neighbours for each query, embeddings first.

    The pool is first cut down to its lexical canopy — the members close enough
    in spelling to SOME query that they could ever clear the match bar. On a
    20,000-account org that is a few thousand records instead of all of them,
    and the encoder, which is the most expensive thing in the stage, only ever
    sees those.
    """
    if not queries or not pool:
        return []

    canopy = _lexical_canopy(queries, pool)
    if not canopy:
        return []

    embedded = _embedding_neighbours(queries, canopy, top_k=top_k)
    if embedded is not None:
        return embedded

    return _fuzzy_neighbours(queries, canopy, top_k=top_k)


def _lexical_canopy(
    queries: list[CanonicalEntity], pool: list[CanonicalEntity]
) -> list[CanonicalEntity]:
    """Pool members within ``name_match_fuzzy_floor`` of at least one query.

    Lossless with respect to the final matches, not an approximation: a pair
    below the floor fails the match bar however perfect its cosine and field
    agreement (see ``name_match_fuzzy_floor``), and a pair above it can only
    rank HIGHER among a smaller pool, so every pair that could have matched
    from the full pool's top-k is still in the canopy's top-k.

    `cdist` runs the comparison in native code across every core, in blocks so
    its score matrix stays small however large the sides get. Pool order is
    preserved, which keeps FAISS tie-breaking — and so the run — deterministic.
    """
    cutoff = name_match_fuzzy_floor() * 100.0
    query_names = [entity.normalized_name for entity in queries]
    pool_names = [entity.normalized_name for entity in pool]

    rows_per_block = max(1, _CANOPY_BLOCK_CELLS // max(len(pool_names), 1))
    keep: set[int] = set()

    for start in range(0, len(query_names), rows_per_block):
        scores: Any = process.cdist(
            query_names[start : start + rows_per_block],
            pool_names,
            scorer=fuzz.token_sort_ratio,
            score_cutoff=cutoff,
            dtype="uint8",
            workers=-1,
        )
        keep.update(int(column) for column in scores.any(axis=0).nonzero()[0])

    return [entity for position, entity in enumerate(pool) if position in keep]


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
    except Exception:
        return None

    pool_array = _embed([entity.normalized_name for entity in pool])
    query_array = _embed([entity.normalized_name for entity in queries])
    if pool_array is None or query_array is None:
        return None

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

#: A float32 matrix, one L2-normalized row per name. numpy is a transitive
#: dependency of the embedding stack rather than a declared one, so it is typed
#: as opaque here for the same reason the encoder is.
Vectors = Any

_VECTORS: dict[str, Any] = {}
_VECTORS_LOCK = threading.Lock()
_ENCODER_LOCK = threading.Lock()


def _embed(names: list[str]) -> Vectors | None:
    """One normalized vector per name, encoding only names not already cached.

    Each distinct name is encoded once however many times it appears. The two
    sides of a reconciliation spell almost every name identically, and the same
    entities are a query in one direction and a pool member in the other, so
    deduplicating here is most of the saving on its own.
    """
    try:
        import numpy as np
    except Exception:
        return None

    model = _encoder()
    if model is None:
        return None

    unique = list(dict.fromkeys(names))
    with _VECTORS_LOCK:
        known = {name: _VECTORS[name] for name in unique if name in _VECTORS}

    missing = [name for name in unique if name not in known]
    if missing:
        try:
            encoded = model.encode(
                missing,
                batch_size=EMBEDDING_BATCH_SIZE,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
        except Exception:
            return None

        fresh = dict(zip(missing, np.asarray(encoded, dtype="float32"), strict=True))
        known.update(fresh)
        with _VECTORS_LOCK:
            if len(_VECTORS) + len(fresh) > _VECTOR_CACHE_LIMIT:
                _VECTORS.clear()
            _VECTORS.update(fresh)

    return np.asarray([known[name] for name in names], dtype="float32")


def _encoder() -> Encoder | None:
    """The process's encoder, loaded at most once even when two threads ask.

    The startup warm-up and a run's match stage can race; without the lock both
    would load the weights and one copy would be thrown away.
    """
    with _ENCODER_LOCK:
        return _load_encoder()


@functools.lru_cache(maxsize=1)
def _load_encoder() -> Encoder | None:
    """Load the sentence encoder once per process.

    Cached because blocking runs per entity type and the harness runs several
    systems over the same data: without this the weights are re-read from disk
    a dozen times per invocation, which dominates the runtime of a stage whose
    entire purpose is to be cheap.

    Local files first. When the weights are already cached the hub has nothing
    to add, and asking it anyway costs several seconds of network round trips
    per process — longer than loading the model. Only a machine that has never
    downloaded them falls through to the network.
    """
    try:
        from sentence_transformers import SentenceTransformer
    except Exception:
        return None

    try:
        return SentenceTransformer(EMBEDDING_MODEL, local_files_only=True)
    except Exception:
        pass

    try:
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
