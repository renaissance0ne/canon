"""Synthetic connector — reads a generated dataset as a source of kind "synthetic".

Phase 1. This is what lets the whole pipeline be developed and evaluated
without touching a real API, and it is the code path the benchmark runs
through. It is not a test fixture: it is a first-class connector.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

from connectors.base import RawRecord
from eval.generate import ENTITY_FILES, SIDE_DIRS
from pipeline.schema import EntityType, SourceKind


class SyntheticConnector:
    """Reads one side of a generated org from ``eval/generate.py`` output."""

    kind: SourceKind = "synthetic"

    def __init__(self, data_dir: Path, side: str) -> None:
        if side not in SIDE_DIRS:
            raise ValueError(f"side must be one of {sorted(SIDE_DIRS)}, got {side!r}")

        #: e.g. ./data/run42
        self.data_dir = data_dir
        #: "a" (the CRM view) or "b" (the warehouse view).
        self.side = side

    def extract(self, entity_type: EntityType) -> Iterator[RawRecord]:
        """Stream one entity type off disk.

        The layout is read through ``ENTITY_FILES`` / ``SIDE_DIRS`` rather than
        rebuilt from string literals, so the generator remains the single
        definition of where a dataset lives. A missing file is an error, not an
        empty stream: a run that silently extracted zero accounts would report a
        perfect reconciliation of nothing.
        """
        path = self.data_dir / SIDE_DIRS[self.side] / ENTITY_FILES[entity_type]

        if not path.is_file():
            raise FileNotFoundError(
                f"{path} does not exist. Generate the dataset first: "
                f"uv run python -m eval.generate --seed 42 --out {self.data_dir}"
            )

        parsed = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(parsed, list):
            raise ValueError(f"{path} must contain a JSON array of records.")

        for record in parsed:
            if not isinstance(record, dict):
                raise ValueError(f"{path} contains a record that is not an object.")
            yield record
