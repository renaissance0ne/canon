"""Credential reads and decryption. SIDE EFFECTS LIVE HERE.

``pipeline/credentials.py`` is the pure contract; this module is the half that
touches Postgres and holds key material, the same split ``db.py`` has against
the pipeline stages.

WHAT REPLACED WHAT
Until this landed, a connector read ``SALESFORCE_PASSWORD`` and friends out of
``engine/.env``. Those keys are gone. They could not express two Salesforce orgs,
could not be rotated without a deploy, and gave every run the same identity no
matter who started it. Credentials now live in ``source_credentials``, encrypted
by the web layer, and are decrypted here for the length of a run.

The AGENTS.md rule that motivated the env-var design is intact and stronger:
a credential is still never in ``sources.config``, is still never readable by
the web layer's UI, and now additionally is not readable by anyone holding only
a database dump.

TABLE OWNERSHIP
``source_credentials`` is WEB-OWNED. This module reads it and never writes it —
the one exception is ``mark_verified``, which stamps ``last_verified_at`` and is
a fact about a connection attempt rather than a change to the credential. A run
whose credentials changed underneath it is a run that cannot be reproduced.

There is exactly one environment variable left in this file's world:
``CANON_CREDENTIAL_KEY``. Something has to be the root of trust, and it holds
the same value as the web layer's copy.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from pipeline.credentials import AuthMethod, SourceCredentials
from pipeline.schema import SourceKind

#: AES-256. The key is always exactly this long by the time it is used.
_KEY_BYTES: Final = 32
#: GCM's designed nonce size. Never anything else.
_IV_BYTES: Final = 12
#: Full-length GCM tag. Truncating trades tamper-evidence for nothing.
_TAG_BYTES: Final = 16


class CredentialKeyError(RuntimeError):
    """The root key is missing or malformed. A deployment problem, not a data one."""


class CredentialDecryptError(RuntimeError):
    """A ciphertext did not authenticate: wrong key, wrong row, or tampered."""


#: Refresh a grant this close to expiry rather than at it. A run takes
#: minutes, and a token valid when the run starts but not when the last
#: extract finishes is the failure this margin exists to avoid.
_EXPIRY_MARGIN: Final = timedelta(minutes=5)


class CredentialsExpiredError(RuntimeError):
    """An OAuth grant is past its expiry and the engine cannot renew it.

    Separate from ``CredentialsMissingError`` because the fix is different:
    missing means "never connected", expired means "connected, reconnect".
    """


class CredentialsMissingError(RuntimeError):
    """A source that needs credentials has none stored.

    Raised early, with the source named, so a run fails at the top with
    something a person can act on rather than inside a connector with a
    ``KeyError``.
    """


def _key_env_var(version: int) -> str:
    return "CANON_CREDENTIAL_KEY" if version == 1 else f"CANON_CREDENTIAL_KEY_V{version}"


_key_cache: dict[int, bytes] = {}


def _key_for(version: int) -> bytes:
    """The root key for a generation, cached.

    Rotation is: add ``CANON_CREDENTIAL_KEY_V2``, have the web layer seal new
    rows under it, and re-encrypt the rest in the background. Old rows keep
    decrypting under their own version throughout, so there is no window where
    credentials are unreadable.
    """
    cached = _key_cache.get(version)
    if cached is not None:
        return cached

    name = _key_env_var(version)
    raw = os.environ.get(name)

    if not raw:
        raise CredentialKeyError(
            f"{name} is not set. It must hold the SAME value as the web layer's copy — "
            f"generate one with `openssl rand -base64 32` and put it in both "
            f"engine/.env and web/.env."
        )

    key = _derive_key(raw, name)
    _key_cache[version] = key
    return key


def _derive_key(raw: str, name: str) -> bytes:
    """Mirrors ``deriveKey`` in web/lib/server/crypto.ts, and must keep mirroring it.

    A 32-byte base64 key is used directly. Anything else is hashed to length so
    a developer who pasted a passphrase gets a working local install — but that
    is strictly weaker than the 256 bits AES is being asked for, so it is
    refused outright when the engine is not obviously running locally.
    """
    try:
        decoded = base64.b64decode(raw, validate=True)
    except (ValueError, binascii.Error):
        decoded = b""

    if len(decoded) == _KEY_BYTES:
        return decoded

    if os.environ.get("CANON_ENV", "development") == "production":
        raise CredentialKeyError(
            f"{name} must be exactly 32 bytes, base64-encoded. Generate one with "
            f"`openssl rand -base64 32`. Refusing to hash a short key in production."
        )

    return hashlib.sha256(raw.encode("utf-8")).digest()


def _aad(source_id: UUID, key_version: int) -> bytes:
    """Additional authenticated data — what this ciphertext is *for*.

    Byte-identical to ``aad()`` in web/lib/server/crypto.ts. It is not stored:
    it is recomputed from the row's own identity, which is exactly why a
    ciphertext copied onto a different source will not decrypt. If these two
    implementations ever drift, every credential in the system stops opening —
    which is the correct failure, and a loud one.
    """
    return f"canon:source-credential:v{key_version}:{source_id}".encode()


def decrypt_secrets(
    *,
    source_id: UUID,
    ciphertext: str,
    iv: str,
    auth_tag: str,
    key_version: int,
) -> dict[str, str]:
    """Open a sealed secret bundle.

    The three base64 columns are separate in Postgres but one message to GCM,
    which expects the tag appended to the ciphertext.
    """
    nonce = base64.b64decode(iv)
    tag = base64.b64decode(auth_tag)

    if len(nonce) != _IV_BYTES or len(tag) != _TAG_BYTES:
        raise CredentialDecryptError(
            "Stored credential has a malformed nonce or tag — the row was not written "
            "by the web layer's crypto module."
        )

    try:
        opened = AESGCM(_key_for(key_version)).decrypt(
            nonce,
            base64.b64decode(ciphertext) + tag,
            _aad(source_id, key_version),
        )
    except InvalidTag as error:
        raise CredentialDecryptError(
            f"Could not decrypt the credential for source {source_id}. Either "
            f"{_key_env_var(key_version)} differs from the web layer's copy, the row was "
            f"copied from another source, or the ciphertext was modified. Reconnect the "
            f"source in the console to re-establish it."
        ) from error

    parsed = json.loads(opened.decode("utf-8"))

    if not isinstance(parsed, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()
    ):
        raise CredentialDecryptError("Decrypted credential was not a flat string map.")

    return parsed


# ── Reads (web-owned table — read freely, write never) ───────────────────────


def load_credentials(source_id: UUID, kind: SourceKind) -> SourceCredentials:
    """Read one source's credentials and decrypt them.

    Returns a ``SourceCredentials`` whose ``__repr__`` is redacted, because the
    single most likely way a secret escapes a Python service is an exception
    traceback that happens to render a model.

    The result is held in memory for the length of a run and never written back,
    never logged, and never returned over the engine's HTTP surface.

    The import of ``db`` is deferred to call time rather than made at module
    scope: ``db`` imports the pipeline, the pipeline imports this module's
    contract, and a top-level import here would close that circle. It also keeps
    this module importable without a database, which is what lets the evaluation
    harness construct a credential in memory.
    """
    from db import load_credential_row

    row = load_credential_row(source_id)

    if row is None:
        raise CredentialsMissingError(
            f"Source {source_id} ({kind}) has no stored credentials. Connect it in "
            f"the console before starting a run."
        )

    secrets = decrypt_secrets(
        source_id=row.source_id,
        ciphertext=row.ciphertext,
        iv=row.iv,
        auth_tag=row.auth_tag,
        key_version=row.key_version,
    )

    return SourceCredentials(
        source_id=row.source_id,
        kind=kind,
        method=row.method,
        public_values=row.public_values,
        secret_values=secrets,
        expires_at=row.expires_at,
        scope=row.scope,
    )


def mark_verified(source_id: UUID, at: datetime) -> None:
    """Stamp ``last_verified_at`` after a successful connection.

    The one write this module makes to a web-owned table, and it is deliberately
    not a change to the credential: it records that a connection attempt
    succeeded, which is what lets the console distinguish "configured" from
    "configured and known to work". Nothing else here writes.

    Note the column list: ``last_verified_at`` and nothing else. Widening this
    statement is how a web-owned table quietly becomes a shared one.
    """
    from db import connect

    with connect() as conn:
        conn.execute(
            "UPDATE source_credentials SET last_verified_at = %s WHERE source_id = %s",
            (at, source_id),
        )


def refresh_oauth_token(credentials: SourceCredentials) -> SourceCredentials:
    """Return a usable grant, or fail with something a person can act on.

    OAuth access tokens are short-lived by design, so a scheduled run will
    routinely start with an expired one.

    WHY THIS DOES NOT CALL A TOKEN ENDPOINT
    A refresh needs the OAuth *app* registration — ``SALESFORCE_OAUTH_CLIENT_ID``
    and its siblings — and AGENTS.md § Security Rules places those in
    ``web/.env`` only, never the engine's. That is not an oversight to route
    around: the authorize half of the flow is browser-driven and lives entirely
    in the web layer, and giving the engine the client secret would put the
    credential that mints grants next to the credentials it mints, in the one
    process that also talks to third-party drivers.

    So the engine's job here is to detect the condition and refuse early, at the
    top of a run, with the source named. The alternative is a 401 from a
    provider three stages in, after entities are already written, which reads
    like a connector bug rather than an expired token.

    Re-establishing the grant is the console's: ``/sources/:id/connect`` runs the
    authorize flow and writes the new tokens through the web layer's own
    encryption path. Two implementations of that write side would be two chances
    to store a credential in clear.
    """
    if credentials.method != "oauth2":
        return credentials

    expires_at = credentials.expires_at
    if expires_at is None:
        # No expiry recorded — a long-lived grant, or a provider that does not
        # report one. Nothing to decide.
        return credentials

    if expires_at > datetime.now(UTC) + _EXPIRY_MARGIN:
        return credentials

    raise CredentialsExpiredError(
        f"The OAuth grant for source {credentials.source_id} ({credentials.kind}) "
        f"expired at {expires_at.isoformat()}. Reconnect it in the console — "
        f"Sources → the source → Connect — which re-runs the authorize flow and "
        f"stores a fresh token. The engine holds no OAuth client secret and "
        f"cannot refresh the grant itself."
    )


def method_for(kind: SourceKind, method: AuthMethod) -> str:
    """Readable identity for logs. Never includes a value — only names."""
    return f"{kind}/{method}"
