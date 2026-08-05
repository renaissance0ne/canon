"""Warehouse connector — Databricks or Snowflake.

Runs the configured SELECT and streams rows. Phase 5.
"""

from __future__ import annotations

from collections.abc import Iterator

from connectors.base import RawRecord
from pipeline.schema import EntityType, SourceKind


class WarehouseConnector:
    """Reads a warehouse over ``databricks-sql-connector``.

    ``DATABRICKS_TOKEN`` / ``SNOWFLAKE_PASSWORD`` come from the engine
    environment. ``sources.config`` holds table names and filters only.
    """

    def __init__(
        self,
        kind: SourceKind,
        tables: dict[str, str],
        row_filter: str | None = None,
    ) -> None:
        self.kind = kind
        #: entity_type → fully qualified table name, from sources.config.
        self.tables = tables
        #: Optional non-secret WHERE clause, from sources.config.
        self.row_filter = row_filter

    def extract(self, entity_type: EntityType) -> Iterator[RawRecord]:
        raise NotImplementedError("Phase 5 — see AGENTS.md § Feature List")
