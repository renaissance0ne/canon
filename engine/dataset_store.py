"""The catalog of generated synthetic datasets on the engine's disk.

``eval/generate.py`` is the generator and knows nothing about HTTP; this module
is the side-effecting layer over it, the same way ``db.py`` is the side-effecting
layer over the pipeline stages. It owns three things the generator deliberately
does not: where datasets live, what a dataset is allowed to be called, and how
one is summarized for a reader who cannot see the disk.

Why the console can create these at all: the synthetic dataset is the source
kind the whole pipeline is developed and evaluated against, and until now the
only way to produce one was a shell on the engine host. That put the one thing a
new operator needs first behind the one thing they are least likely to have. The
parameters are the generator's own — seed, account count, injection rates — so a
dataset built from the console is byte-identical to one built by::

    uv run python -m eval.generate --seed 42 --accounts 500 --out ./data/run42

NOTHING HERE TALKS TO A NETWORK, and no credential is read. That is inherited
from the generator and it is worth restating: a synthetic dataset is trustworthy
ground truth precisely because it was constructed rather than observed.

Named ``dataset_store`` rather than ``datasets`` because the latter is a widely
installed third-party top-level module, and a local one would shadow it for
every package in this environment that imports it.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Final

from eval.generate import (
    ESCALATE,
    MANIFEST_FILE,
    META_FILE,
    generate,
    load_manifest,
)
from eval.generate import (
    InjectionRates as GeneratorRates,
)
from pipeline.schema import (
    DatasetDetail,
    DatasetSummary,
    GenerateDatasetRequest,
    InjectionRates,
    ManifestDivergence,
)

#: Where generated datasets live. One directory per dataset, named by the
#: console or the CLI's ``--out``. It is an engine setting because the disk is
#: the engine's: the console names a dataset, never a path.
DATASET_ROOT_ENV: Final = "CANON_DATASET_ROOT"
DEFAULT_DATASET_ROOT: Final = "./data"

#: A directory name and nothing else. No separator, no leading dot, no drive
#: letter — a name that cannot be a traversal is safer than a path that has to
#: be checked for one, and this is the only string the web layer contributes to
#: a filesystem operation in the entire engine.
NAME_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class DatasetError(ValueError):
    """A dataset request that cannot be satisfied. Reported as 400."""


class DatasetExistsError(DatasetError):
    """The name is taken and ``force`` was not set. Reported as 409."""


def dataset_root() -> Path:
    return Path(os.environ.get(DATASET_ROOT_ENV, DEFAULT_DATASET_ROOT))


def dataset_path(name: str) -> Path:
    """Resolve a dataset name to a directory under the root.

    Validated twice on purpose: once by pattern, and once by checking the
    resolved parent, so a name that somehow satisfies the pattern still cannot
    land outside the root on a filesystem that normalizes differently than this
    code expects.
    """
    if not NAME_PATTERN.fullmatch(name):
        raise DatasetError(
            f"{name!r} is not a dataset name. Use letters, digits, dot, dash or "
            f"underscore — it names a directory on the engine, not a path."
        )

    root = dataset_root()
    path = root / name

    if path.resolve().parent != root.resolve():
        raise DatasetError(f"{name!r} does not resolve to a dataset under {root}.")

    return path


def list_datasets() -> list[DatasetSummary]:
    """Every readable dataset under the root, oldest name first.

    A directory that is not a dataset, or one whose meta.json is unreadable, is
    skipped rather than raised on. The listing is a picker: one broken directory
    must not make the other five unselectable.
    """
    root = dataset_root()
    if not root.is_dir():
        return []

    summaries: list[DatasetSummary] = []
    for entry in sorted(root.iterdir(), key=lambda path: path.name):
        if not entry.is_dir() or not NAME_PATTERN.fullmatch(entry.name):
            continue
        summary = read_dataset(entry.name)
        if summary is not None:
            summaries.append(summary)

    return summaries


def read_dataset(name: str) -> DatasetSummary | None:
    """Summarize one dataset, or ``None`` if that directory does not hold one.

    The counts come from ``meta.json``; the class breakdown comes from the
    manifest itself, because the manifest is the ground truth every reported
    number is measured against and a summary of it should be derived from it
    rather than from a second file that could disagree.
    """
    path = dataset_path(name)
    meta_file = path / META_FILE

    if not meta_file.is_file() or not (path / MANIFEST_FILE).is_file():
        return None

    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        entries = load_manifest(path)
    except (OSError, ValueError):
        return None

    if not isinstance(meta, dict):
        return None

    by_class: dict[str, int] = {}
    for entry in entries:
        by_class[entry.conflict_class] = by_class.get(entry.conflict_class, 0) + 1

    counts = meta.get("counts")
    counts = counts if isinstance(counts, dict) else {}

    return DatasetSummary(
        name=name,
        generator_version=_int(meta.get("generatorVersion")),
        seed=_int(meta.get("seed")),
        accounts=_int(meta.get("accounts")),
        # meta.json writes the generator's own snake_case keys;
        # `populate_by_name` is what lets one model read both spellings.
        rates=InjectionRates.model_validate(meta.get("rates") or {}),
        entities_a=_total(counts.get("sideA")),
        entities_b=_total(counts.get("sideB")),
        divergences=len(entries),
        by_class=by_class,
        escalations=sum(1 for entry in entries if entry.expected_resolution == ESCALATE),
    )


def read_detail(
    name: str,
    *,
    limit: int = 200,
    offset: int = 0,
    conflict_class: str | None = None,
    expected: str | None = None,
) -> DatasetDetail | None:
    """One dataset plus a page of its ground-truth manifest.

    The manifest is the answer key: for every divergence it says what each side
    holds, what the canonical org actually says, and what a correct system
    resolves to. Reading it in the console is what turns "500 accounts, 208
    divergences" into something a reviewer can check by eye.

    ``expected`` splits the manifest on the distinction that matters most:
    ``escalate`` are the deliberately ambiguous cases, and a system is scored on
    whether it hands those to a human rather than guessing. ``resolvable`` is
    everything else.
    """
    summary = read_dataset(name)
    if summary is None:
        return None

    entries = load_manifest(dataset_path(name))

    if conflict_class is not None:
        entries = [entry for entry in entries if entry.conflict_class == conflict_class]

    if expected == ESCALATE:
        entries = [entry for entry in entries if entry.expected_resolution == ESCALATE]
    elif expected == "resolvable":
        entries = [entry for entry in entries if entry.expected_resolution != ESCALATE]

    window = entries[offset : offset + limit]

    return DatasetDetail(
        dataset=summary,
        divergences=[
            ManifestDivergence(
                entity_id=entry.entity_id,
                field=entry.field,
                true_value=entry.true_value,
                side_a_value=entry.side_a_value,
                side_b_value=entry.side_b_value,
                conflict_class=entry.conflict_class,
                expected_resolution=entry.expected_resolution,
            )
            for entry in window
        ],
        total=len(entries),
        limit=limit,
        offset=offset,
    )


def create_dataset(request: GenerateDatasetRequest) -> DatasetSummary:
    """Generate a dataset and return its summary.

    Synchronous. Generation is CPU-bound, offline and fast at the sizes the
    console offers, and a background task would buy nothing but a second status
    surface to poll — the request finishing IS the completion signal.
    """
    path = dataset_path(request.name)

    try:
        generate(
            seed=request.seed,
            accounts=request.accounts,
            out_dir=path,
            rates=GeneratorRates(**request.rates.model_dump()),
            force=request.force,
        )
    except FileExistsError as error:
        # Reworded rather than passed through: the generator's own message is
        # written for the CLI and names `--force` and `--out`, which are not
        # things a console user has. It also carries the engine's filesystem
        # path, which nothing in the browser has any business seeing.
        raise DatasetExistsError(
            f"{request.name!r} already holds a dataset. Reported results cite a seed, "
            f"so replacing one silently would make those numbers unreproducible — "
            f"choose another name, or overwrite it deliberately."
        ) from error
    except ValueError as error:
        raise DatasetError(str(error)) from error

    summary = read_dataset(request.name)
    if summary is None:
        # The generator wrote the directory a line ago. If it cannot be read
        # back, something is wrong with the disk and not with the request.
        raise OSError(f"Generated {path} but could not read it back.")

    return summary


def _int(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _total(counts: object) -> int:
    """Records on one side, summed across entity types."""
    if not isinstance(counts, dict):
        return 0
    return sum(value for value in counts.values() if isinstance(value, int))
