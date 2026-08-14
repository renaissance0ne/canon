"""Salesforce connector — Account, User, UserRole, Territory.

Phase 5. Real connectors come late on purpose: they are the highest-friction,
lowest-insight part of the build, and the synthetic connector already proves the
pipeline.

Everything here is a READ. Canon proposes and records; it does not mutate source
systems, so there is no update path in this module and there must not be one
without an explicit decision to change the project's risk profile.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from connectors.base import RawRecord
from pipeline.credentials import SourceCredentials
from pipeline.schema import EntityType, SourceKind

#: Which Salesforce object backs each canonical entity type, and which of its
#: fields become the canonical shape.
#:
#: Declared rather than inferred because SOQL has no ``SELECT *``: the field list
#: is mandatory, and having it in one table means a reader can see exactly what
#: Canon reads from an org — which is the first question a security review asks.
_OBJECTS: dict[EntityType, tuple[str, tuple[str, ...]]] = {
    "account": (
        "Account",
        (
            "Id",
            "Name",
            "ParentId",
            "LastModifiedDate",
            "OwnerId",
            "Industry",
            "Type",
            "BillingCountry",
        ),
    ),
    "user": (
        "User",
        (
            "Id",
            "Name",
            "ManagerId",
            "LastModifiedDate",
            "UserRoleId",
            "IsActive",
            "Email",
            "Title",
        ),
    ),
    "role": ("UserRole", ("Id", "Name", "ParentRoleId", "DeveloperName")),
    "territory": ("Territory2", ("Id", "Name", "ParentTerritory2Id", "LastModifiedDate")),
}

#: Salesforce field → the canonical key the pipeline expects. Anything not named
#: here is carried through as an attribute under its own name, so adding a field
#: to ``_OBJECTS`` is enough to surface it in a diff.
_CANONICAL: dict[str, str] = {
    "Id": "externalId",
    "Name": "name",
    "LastModifiedDate": "lastModifiedAt",
}

#: Per object, the field that holds the hierarchy edge. Salesforce spells it
#: differently on every object, which is exactly the kind of per-source detail
#: the canonical schema exists to absorb.
_PARENT_FIELD: dict[EntityType, str] = {
    "account": "ParentId",
    "user": "ManagerId",
    "role": "ParentRoleId",
    "territory": "ParentTerritory2Id",
}

#: simple-salesforce ships no type information (see the mypy overrides in
#: pyproject.toml), so its client is opaque to the checker. Named rather than
#: an inline `Any` so the reason travels with it.
SalesforceClient = Any

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
        self._client: SalesforceClient | None = None

    @property
    def login_host(self) -> str:
        """``login.salesforce.com``, or a sandbox / My Domain host."""
        return self.credentials.public("loginHost", "login.salesforce.com")

    def extract(self, entity_type: EntityType) -> Iterator[RawRecord]:
        """Stream one entity type out of the org.

        An entity type the org does not expose yields nothing rather than
        raising. Territory management is off by default in Salesforce, and a run
        against an org without it should reconcile the three objects that do
        exist rather than fail entirely — the absence shows up honestly as
        orphans on the other side.
        """
        object_name, fields = _OBJECTS[entity_type]

        if not self._includes(object_name):
            return

        query = f"SELECT {', '.join(fields)} FROM {object_name}"

        try:
            response = self._connection().query_all_iter(query)
        except Exception as error:
            if _is_missing_object(error):
                return
            raise

        for record in response:
            yield _to_raw(record, entity_type)

    # ── internals ────────────────────────────────────────────────────────────

    def _includes(self, object_name: str) -> bool:
        """Whether ``sources.config.objects`` asked for this object.

        An empty list means "everything Canon knows how to read", which is what
        the console sends when a user has not narrowed the scope.
        """
        if not self.objects:
            return True
        return object_name.casefold() in {name.casefold() for name in self.objects}

    def _connection(self) -> SalesforceClient:
        """Build the Salesforce client once per run, from the decrypted grant.

        This is the only method that touches a secret. It reads them through
        ``credentials.secret(...)``, which raises with the source named rather
        than a bare ``KeyError`` three frames into a third-party library.
        """
        if self._client is not None:
            return self._client

        from simple_salesforce.api import Salesforce

        if self.credentials.method == "oauth2":
            instance_url = self.credentials.public("instanceUrl") or f"https://{self.login_host}"
            self._client = Salesforce(
                instance_url=instance_url,
                session_id=self.credentials.secret("accessToken"),
            )
        else:
            self._client = Salesforce(
                username=self.credentials.public("username"),
                password=self.credentials.secret("password"),
                # Blank when the org allowlists the engine's IP, which is a
                # supported configuration rather than a missing credential.
                security_token=self.credentials.secret_values.get("securityToken", ""),
                domain="test" if "test." in self.login_host else "login",
            )

        return self._client


def _to_raw(record: dict[str, object], entity_type: EntityType) -> RawRecord:
    """One Salesforce row → the flat camelCase shape ``normalize`` consumes.

    The same shape the synthetic connector emits, which is the point: both go
    through the identical ``normalize`` path, so a benchmark number measured on
    generated data describes the behaviour on a real org too.
    """
    parent_field = _PARENT_FIELD[entity_type]
    raw: dict[str, str | None] = {}

    for key, value in record.items():
        # simple-salesforce returns this on every row; it describes the API
        # response, not the record.
        if key == "attributes":
            continue

        if key == parent_field:
            raw["parentExternalId"] = _text(value)
            continue

        raw[_CANONICAL.get(key, _lower_first(key))] = _text(value)

    raw.setdefault("parentExternalId", None)
    raw.setdefault("lastModifiedAt", None)
    return raw


def _text(value: object) -> str | None:
    """Every value the pipeline compares is text. Booleans included.

    ``True`` and ``"true"`` are the same fact about a record, and letting two
    representations reach ``detect`` would report a conflict between a source
    that returns JSON booleans and one that returns strings.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _lower_first(name: str) -> str:
    """``BillingCountry`` → ``billingCountry``.

    Salesforce is PascalCase and the canonical attribute keys are camelCase.
    Only the first character moves: ``OwnerId`` must not become ``ownerid``,
    because the survivorship rules name ``ownerId`` exactly.
    """
    return name[:1].lower() + name[1:] if name else name


def _is_missing_object(error: Exception) -> bool:
    """Whether a query failed because the object is not in this org.

    Matched on the API's own error names rather than the HTTP status, because a
    404 from Salesforce can equally mean a bad session — and silently skipping
    an entity type because the token expired would turn an auth failure into a
    reconciliation that quietly compared nothing.
    """
    text = str(error)
    return "INVALID_TYPE" in text or "NOT_FOUND" in text and "sObject type" in text
