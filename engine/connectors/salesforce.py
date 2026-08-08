"""Salesforce connector — Account, User, UserRole, Territory.

Phase 5. Real connectors come late on purpose: they are the highest-friction,
lowest-insight part of the build, and the synthetic connector already proves the
pipeline.
"""

from __future__ import annotations

from collections.abc import Iterator

from connectors.base import RawRecord
from pipeline.credentials import SourceCredentials
from pipeline.schema import EntityType, SourceKind


class SalesforceConnector:
    """Reads a Salesforce org over REST/Bulk via ``simple-salesforce``.

    Credentials arrive as a decrypted ``SourceCredentials`` rather than out of
    the environment. That is what lets one deployment reconcile two Salesforce
    orgs — a per-``kind`` env var could only ever describe one.

    Two auth methods, and the connector treats them as genuinely different
    rather than normalizing them into a lowest common denominator:

        oauth2      an access token plus an instance URL. Preferred: the grant
                    is scoped, expiring and revocable from Salesforce's own UI
                    without Canon's involvement.
        password    username + password + security token. Works without a
                    Connected App and ages badly.
    """

    kind: SourceKind = "salesforce"

    def __init__(self, credentials: SourceCredentials, objects: list[str]) -> None:
        if credentials.kind != "salesforce":
            raise ValueError(f"SalesforceConnector given {credentials.kind} credentials")

        #: Decrypted, in memory, for the length of a run. Never logged, never
        #: written back, never returned over the engine's HTTP surface.
        self.credentials = credentials
        #: Non-secret connection shape, from sources.config.
        self.objects = objects

    @property
    def login_host(self) -> str:
        """``login.salesforce.com``, or a sandbox / My Domain host."""
        return self.credentials.public("loginHost", "login.salesforce.com")

    def extract(self, entity_type: EntityType) -> Iterator[RawRecord]:
        raise NotImplementedError("Phase 5 — see AGENTS.md § Feature List")
