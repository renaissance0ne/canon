"""Warehouse connector — Databricks or Snowflake.

Runs the configured SELECT and streams rows. Phase 5.

Read-only, and structurally so: the only statement this module builds is a
SELECT, the table name is validated as an identifier before it reaches SQL, and
the row filter is the one place a caller's text enters a query — see
``_validated_filter`` for why that is bounded rather than trusted.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from connectors.base import RawRecord
from pipeline.credentials import SourceCredentials
from pipeline.schema import EntityType, SourceKind

#: Columns every warehouse table must expose, in canonical form. A warehouse
#: table is modelled by whoever built the ETL, so Canon states its contract
#: rather than guessing: these four names, spelled exactly, plus anything else
#: the table happens to carry, which is surfaced as an attribute.
_REQUIRED_COLUMNS: tuple[str, ...] = ("external_id", "name")

#: Warehouse column → canonical key. Everything else is carried through as an
#: attribute under its camelCase name, so adding a column to the view is enough
#: to put it in a diff.
_CANONICAL: dict[str, str] = {
    "external_id": "externalId",
    "externalid": "externalId",
    "name": "name",
    "parent_external_id": "parentExternalId",
    "parentexternalid": "parentExternalId",
    "last_modified_at": "lastModifiedAt",
    "lastmodifiedat": "lastModifiedAt",
}

#: A schema-qualified identifier and nothing else. Table names come from
#: ``sources.config``, which the console writes — but "the console wrote it" is
#: not the same as "it is safe to concatenate into SQL", and this is the only
#: defence between a jsonb column and the query planner.
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$")

#: Characters that would end the WHERE clause and begin something else. A filter
#: is a fragment of a predicate, not a place to put a second statement.
_FILTER_FORBIDDEN = re.compile(r"[;]|--|/\*|\*/")

#: Neither warehouse driver ships type information (see the mypy overrides in
#: pyproject.toml), and the DB-API shapes they return are described by a PEP
#: rather than by a type. Named aliases so the reason travels with them.
DriverConnection = Any
DriverCursor = Any
DriverRow = Any
ColumnDescription = Any

#: Rows per fetch. Large enough that a 50k-row table is a handful of round
#: trips, small enough that the driver never materializes the whole table.
_FETCH_SIZE = 5000


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
        self._connection: DriverConnection | None = None

    def extract(self, entity_type: EntityType) -> Iterator[RawRecord]:
        """Stream one entity type out of its configured table.

        An entity type with no table configured yields nothing. A warehouse
        commonly models accounts and users and nothing else, and a run against
        it should reconcile what is there rather than fail — the gap surfaces
        honestly as orphans on the CRM side.
        """
        table = self.tables.get(entity_type)
        if not table:
            return

        statement = f"SELECT * FROM {_validated_table(table)}"
        predicate = _validated_filter(self.row_filter)
        if predicate:
            statement += f" WHERE {predicate}"

        with self._cursor() as cursor:
            cursor.execute(statement)
            columns = [_column_name(column) for column in cursor.description or []]
            _require_columns(columns, table)

            while True:
                rows = cursor.fetchmany(_FETCH_SIZE)
                if not rows:
                    break
                for row in rows:
                    yield _to_raw(columns, row)

    # ── internals ────────────────────────────────────────────────────────────

    def _cursor(self) -> _CursorContext:
        return _CursorContext(self._connect())

    def _connect(self) -> DriverConnection:
        """Open the driver connection once per run, from the decrypted grant.

        The only method in this module that touches a secret. Both drivers are
        imported lazily so an engine reconciling Databricks never has to have a
        working Snowflake driver installed, and vice versa.
        """
        if self._connection is not None:
            return self._connection

        if self.kind == "databricks":
            from databricks import sql

            self._connection = sql.connect(
                server_hostname=self.credentials.public("serverHostname"),
                http_path=self.credentials.public("httpPath"),
                access_token=self.credentials.secret("accessToken"),
            )
        else:
            self._connection = _connect_snowflake(self.credentials)

        return self._connection


def _connect_snowflake(credentials: SourceCredentials) -> DriverConnection:
    """Snowflake, by whichever of its three methods this credential carries.

    Key pair is Snowflake's own recommendation for service accounts and is the
    first branch for that reason; password is supported because it works
    everywhere and is what a developer reaches for first.
    """
    try:
        import snowflake.connector
    except ImportError as error:  # pragma: no cover - depends on the install
        raise RuntimeError(
            "This source is Snowflake, but snowflake-connector-python is not "
            "installed. Add it to engine/pyproject.toml and run `uv sync`. "
            "Databricks needs no extra install."
        ) from error

    common: dict[str, Any] = {
        "account": credentials.public("account"),
        "user": credentials.public("user"),
        "warehouse": credentials.public("warehouse"),
    }
    role = credentials.public("role")
    if role:
        common["role"] = role

    if credentials.method == "keypair":
        common["private_key"] = _load_private_key(credentials)
    elif credentials.method == "oauth2":
        common["authenticator"] = "oauth"
        common["token"] = credentials.secret("accessToken")
    else:
        common["password"] = credentials.secret("password")

    return snowflake.connector.connect(**common)


def _load_private_key(credentials: SourceCredentials) -> bytes:
    """PEM text → the DER bytes the Snowflake driver wants.

    The passphrase is optional because a key may be generated unencrypted;
    ``None`` is the driver's own spelling for that and is not the same as an
    empty passphrase.
    """
    from cryptography.hazmat.primitives import serialization

    passphrase = credentials.secret_values.get("privateKeyPassphrase") or None

    key = serialization.load_pem_private_key(
        credentials.secret("privateKey").encode("utf-8"),
        password=passphrase.encode("utf-8") if passphrase else None,
    )
    return key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


class _CursorContext:
    """A cursor that closes itself, across two drivers that disagree about that.

    The Databricks cursor is a context manager and Snowflake's is not, so
    wrapping is what lets ``extract`` read the same for both.
    """

    def __init__(self, connection: DriverConnection) -> None:
        self._connection = connection
        self._cursor: DriverCursor | None = None

    def __enter__(self) -> DriverCursor:
        self._cursor = self._connection.cursor()
        return self._cursor

    def __exit__(self, *exc_info: object) -> None:
        if self._cursor is not None:
            self._cursor.close()


def _validated_table(table: str) -> str:
    """A table name, or a refusal.

    ``sources.config`` is jsonb written by the web layer; the web layer
    validates its own inputs, but this is the boundary where that text becomes
    SQL and the check has to exist on this side of it too. Catalog.schema.table
    is the deepest form either warehouse uses.
    """
    if not _IDENTIFIER.match(table):
        raise ValueError(
            f"{table!r} is not a valid table identifier. Expected name, schema.name, "
            f"or catalog.schema.name."
        )
    return table


def _validated_filter(row_filter: str | None) -> str:
    """A WHERE fragment, bounded.

    Canon reads only, so the damage a filter could do is limited — but "limited"
    is not "none", and a statement terminator or comment opener in a predicate
    is never a legitimate filter. Rejected rather than escaped: escaping SQL by
    hand is how escaping goes wrong.
    """
    if not row_filter:
        return ""
    if _FILTER_FORBIDDEN.search(row_filter):
        raise ValueError(
            "A row filter may not contain a statement terminator or a comment. "
            "Write it as a single predicate, e.g. `is_deleted = false`."
        )
    return row_filter


def _column_name(column: ColumnDescription) -> str:
    """First element of a DB-API description tuple, lowercased.

    Snowflake upper-cases unquoted identifiers and Databricks preserves them, so
    a canonical mapping keyed on lowercase is the only way one column list reads
    the same from both.
    """
    name = column[0] if isinstance(column, (tuple, list)) else getattr(column, "name", column)
    return str(name).lower()


def _require_columns(columns: list[str], table: str) -> None:
    missing = [name for name in _REQUIRED_COLUMNS if name not in columns]
    if missing:
        raise ValueError(
            f"Table {table} is missing required column(s) {missing}. Canon expects "
            f"external_id and name, plus optional parent_external_id and "
            f"last_modified_at; everything else is carried as an attribute."
        )


def _to_raw(columns: list[str], row: DriverRow) -> RawRecord:
    """One warehouse row → the flat camelCase shape ``normalize`` consumes.

    Identical in shape to what the Salesforce and synthetic connectors emit,
    which is what lets one ``normalize`` serve all three.
    """
    values = list(row) if not isinstance(row, dict) else [row[name] for name in columns]

    raw: dict[str, str | None] = {}
    for name, value in zip(columns, values, strict=False):
        raw[_CANONICAL.get(name, _camel(name))] = _text(value)

    raw.setdefault("parentExternalId", None)
    raw.setdefault("lastModifiedAt", None)
    return raw


def _text(value: object) -> str | None:
    """Every value the pipeline compares is text.

    Warehouse drivers return native types — datetimes, Decimals, bools — and two
    sources returning ``True`` and ``"true"`` for the same fact must not read as
    a conflict. Timestamps become ISO 8601 because that is what the recency
    rules parse.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        # `str` on a Decimal keeps the scale the warehouse declared; float would
        # introduce a representation difference that reads as a conflict.
        return str(value)
    return str(value)


def _camel(name: str) -> str:
    """``billing_country`` → ``billingCountry``.

    Warehouse columns are snake_case by convention and the canonical attribute
    keys are camelCase; the survivorship rules name ``ownerId`` exactly, so this
    has to be the inverse of what the rules expect rather than a loose
    normalization.
    """
    head, *rest = name.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)
