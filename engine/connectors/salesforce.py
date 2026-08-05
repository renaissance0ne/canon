"""Salesforce connector — Account, User, UserRole, Territory.

Phase 5. Real connectors come late on purpose: they are the highest-friction,
lowest-insight part of the build, and the synthetic connector already proves the
pipeline. Every hour spent on OAuth is an hour not spent on the contribution.
"""

from __future__ import annotations

from collections.abc import Iterator

from connectors.base import RawRecord
from pipeline.schema import EntityType, SourceKind


class SalesforceConnector:
    """Reads a Salesforce org over REST/Bulk via ``simple-salesforce``.

    Credentials (``SALESFORCE_CLIENT_ID`` / ``_SECRET`` / ``_USERNAME`` /
    ``_PASSWORD`` / ``_TOKEN``) are read from the engine environment. They must
    never appear in ``sources.config`` or anywhere in the web layer.
    """

    kind: SourceKind = "salesforce"

    def __init__(self, objects: list[str]) -> None:
        #: Non-secret connection shape, from sources.config.
        self.objects = objects

    def extract(self, entity_type: EntityType) -> Iterator[RawRecord]:
        raise NotImplementedError("Phase 5 — see AGENTS.md § Feature List")
