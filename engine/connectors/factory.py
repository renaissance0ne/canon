"""Source row → live connector. The one place credentials meet a client.

Every connector is constructed here and nowhere else. That matters for a reason
beyond tidiness: this is the only function in the engine that holds a decrypted
credential and hands it to third-party library code, so it is the only place
that has to be audited for "does a secret escape into a log, a URL or an
exception".

Kept out of ``main.py`` because it is a pure mapping — given a source and its
credentials, it returns a connector, touching nothing. That lets
``eval/harness.py`` build the identical connector the production path builds,
which is the property that makes the benchmark's numbers mean anything.
"""

from __future__ import annotations

from pathlib import Path

from connectors.base import Connector
from connectors.salesforce import SalesforceConnector
from connectors.synthetic import SyntheticConnector
from connectors.warehouse import WarehouseConnector
from pipeline.credentials import SourceCredentials, requires_credentials
from pipeline.schema import SourceKind


class ConnectorConfigError(ValueError):
    """A source whose config and credentials cannot produce a working connector."""


def build_connector(
    *,
    kind: SourceKind,
    config: dict[str, object],
    credentials: SourceCredentials | None,
    side: str = "a",
    data_dir: Path | None = None,
) -> Connector:
    """Construct the connector for one side of a run.

    ``credentials`` is ``None`` only for ``synthetic``, and that is checked
    rather than assumed: a missing credential on a real source must fail here,
    at the top of the run, and not three frames into a driver with a message
    about a null token.
    """
    if requires_credentials(kind) and credentials is None:
        raise ConnectorConfigError(
            f"Source kind {kind!r} needs credentials and none are stored. "
            f"Connect it in the console before starting a run."
        )

    if credentials is not None and credentials.kind != kind:
        raise ConnectorConfigError(
            f"Credentials are for {credentials.kind!r} but the source is {kind!r}."
        )

    if kind == "synthetic":
        if data_dir is None:
            raise ConnectorConfigError("A synthetic source needs a data directory.")
        return SyntheticConnector(data_dir=data_dir, side=side)

    if kind == "salesforce":
        assert credentials is not None  # guarded above; narrows for mypy
        return SalesforceConnector(credentials=credentials, objects=_objects(config))

    if kind in ("databricks", "snowflake"):
        assert credentials is not None
        return WarehouseConnector(
            credentials=credentials,
            tables=_tables(config),
            row_filter=_row_filter(config),
        )

    # `hubspot` has a credential schema and no connector yet. Saying so beats a
    # silent fallthrough that returns something that cannot read anything.
    raise ConnectorConfigError(f"No connector is implemented for source kind {kind!r}.")


def _objects(config: dict[str, object]) -> list[str]:
    """``sources.config.objects`` — object or table names, never a credential."""
    objects = config.get("objects")

    if not isinstance(objects, list) or not all(isinstance(o, str) for o in objects):
        raise ConnectorConfigError("sources.config.objects must be a list of strings.")

    return [str(o) for o in objects]


def _tables(config: dict[str, object]) -> dict[str, str]:
    """Warehouse sources name one table per entity type, in `objects` order."""
    names = _objects(config)
    entity_types = ("account", "user", "role", "territory")
    return dict(zip(entity_types, names, strict=False))


def _row_filter(config: dict[str, object]) -> str | None:
    row_filter = config.get("filter")
    return row_filter if isinstance(row_filter, str) and row_filter else None
