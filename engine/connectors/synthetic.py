"""Synthetic connector — reads a generated dataset as a source of kind "synthetic".

Phase 1. This is what lets the whole pipeline be developed and evaluated
without touching a real API, and it is the code path the benchmark runs
through. It is not a test fixture: it is a first-class connector.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from connectors.base import RawRecord
from pipeline.schema import EntityType, SourceKind


class SyntheticConnector:
    """Reads one side of a generated org from ``eval/generate.py`` output."""

    kind: SourceKind = "synthetic"

    def __init__(self, data_dir: Path, side: str) -> None:
        #: e.g. ./data/run42
        self.data_dir = data_dir
        #: "a" (the CRM view) or "b" (the warehouse view).
        self.side = side

    def extract(self, entity_type: EntityType) -> Iterator[RawRecord]:
        raise NotImplementedError("Phase 1 — see AGENTS.md § Feature List")
