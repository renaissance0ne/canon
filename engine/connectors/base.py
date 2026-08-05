"""The Connector protocol.

A connector's only job is to read raw records out of a source system. It does
not normalize, match or classify — those are pipeline stages, and keeping them
out of here is what lets the synthetic connector exercise the identical code
path as Salesforce.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Protocol, runtime_checkable

from pipeline.schema import EntityType, SourceKind

#: A record exactly as the source system returned it. Deliberately untyped:
#: shape is the source's business, and normalize.py is where it becomes ours.
#: This never crosses the web/engine boundary — only CanonicalEntity does.
RawRecord = Mapping[str, object]


@runtime_checkable
class Connector(Protocol):
    """Reads one configured source system.

    Credentials come from the engine environment keyed by ``kind`` — never from
    ``sources.config``, which holds non-secret connection shape only.
    """

    kind: SourceKind

    def extract(self, entity_type: EntityType) -> Iterator[RawRecord]:
        """Stream every record of ``entity_type``.

        Streaming rather than returning a list: a real org's Account table does
        not need to be resident all at once to be normalized.
        """
        ...
