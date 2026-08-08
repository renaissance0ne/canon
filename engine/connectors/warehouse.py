"""Warehouse connector — Databricks or Snowflake.

Runs the configured SELECT and streams rows. Phase 5.
"""

from __future__ import annotations

from collections.abc import Iterator

from connectors.base import RawRecord
from pipeline.credentials import SourceCredentials
from pipeline.schema import EntityType, SourceKind


class WarehouseConnector:
    """Reads a warehouse over ``databricks-sql-connector`` or the Snowflake driver.

    Credentials arrive decrypted from ``source_credentials``; ``sources.config``
    still holds table names and filters only. The split is the same one it
    always was — what changed is that the secret half is now per-source and
    encrypted rather than a static key in the engine's environment.

    The connection shape lives in ``credentials.public_values`` rather than
    being passed separately, because a Databricks HTTP path and its token are
    two halves of one credential: they are established together on the connect
    screen and a run that had one without the other could not connect anyway.
    """

    def __init__(
        self,
        credentials: SourceCredentials,
        tables: dict[str, str],
        row_filter: str | None = None,
    ) -> None:
        if credentials.kind not in ("databricks", "snowflake"):
            raise ValueError(f"WarehouseConnector given {credentials.kind} credentials")

        self.kind: SourceKind = credentials.kind
        #: Decrypted, in memory, for the length of a run.
        self.credentials = credentials
        #: entity_type → fully qualified table name, from sources.config.
        self.tables = tables
        #: Optional non-secret WHERE clause, from sources.config.
        self.row_filter = row_filter

    def extract(self, entity_type: EntityType) -> Iterator[RawRecord]:
        raise NotImplementedError("Phase 5 — see AGENTS.md § Feature List")
