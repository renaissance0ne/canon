"""The credential contract.

Mirrors ``web/types/credentials.ts`` exactly. AGENTS.md: *do not change one side
without changing the other in the same commit.*

Two things live here and nothing else:

    the schema      which fields each platform needs, and which of them are secret
    the payload     what a decrypted credential looks like once the engine has it

Reading and decrypting are side effects and live in ``engine/credentials.py``,
the same way DB writes live in ``db.py`` — this module stays pure so the
evaluation harness can construct a credential without a database.

There are no credential *values* in this file, and there is no fallback to the
environment. ``SALESFORCE_PASSWORD`` and friends were removed from
``engine/.env.example`` when this landed: a static key per integration cannot
express "two Salesforce orgs" and cannot be rotated without a deploy.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from pipeline.schema import CanonModel, SourceKind

# ── Enumerations (mirror the Zod enums in web/types/credentials.ts) ──────────

#: How a source proves who it is. ``oauth2`` is preferred everywhere it exists:
#: it is the only method where Canon holds a scoped, revocable, expiring grant
#: rather than a reusable password.
AuthMethod = Literal["oauth2", "token", "password", "keypair", "none"]

#: ``secret`` is encrypted at rest and never leaves the engine; ``public`` is
#: connection shape the console is allowed to display.
FieldSensitivity = Literal["secret", "public"]

FieldInput = Literal["text", "password", "textarea"]


class CredentialFieldSpec(CanonModel):
    """One input on the connect form. Mirrors ``CredentialFieldSpec`` in TS."""

    key: str
    label: str
    sensitivity: FieldSensitivity
    input: FieldInput
    placeholder: str | None = None
    hint: str | None = None
    optional: bool = False
    max_length: int | None = None


class OAuthSpec(CanonModel):
    """An OAuth 2.0 provider, described rather than coded.

    ``authorize_url`` / ``token_url`` are templates: ``{key}`` is substituted
    from the method's public fields. That is what lets one declaration cover a
    Salesforce sandbox and a production org without a branch in the flow.

    The engine only ever reads ``token_url`` — refreshing an expired access
    token is its job. The authorize half runs in the web layer, which is the
    only side with a browser.
    """

    authorize_url: str
    token_url: str
    scopes: list[str]
    pkce: bool
    client_id_env: str
    client_secret_env: str | None = None
    extra_authorize_params: dict[str, str] = Field(default_factory=dict)


class AuthMethodSpec(CanonModel):
    method: AuthMethod
    label: str
    summary: str
    fields: list[CredentialFieldSpec] = Field(default_factory=list)
    oauth: OAuthSpec | None = None

    @property
    def secret_keys(self) -> set[str]:
        return {f.key for f in self.fields if f.sensitivity == "secret"}

    @property
    def public_keys(self) -> set[str]:
        return {f.key for f in self.fields if f.sensitivity == "public"}

    @property
    def required_keys(self) -> set[str]:
        return {f.key for f in self.fields if not f.optional}


class PlatformCredentialSpec(CanonModel):
    kind: SourceKind
    label: str
    #: Ordered. The first entry is the recommended method.
    methods: list[AuthMethodSpec]


# ── Field fragments reused across platforms ─────────────────────────────────

_SALESFORCE_LOGIN_HOST = CredentialFieldSpec(
    key="loginHost",
    label="Login host",
    sensitivity="public",
    input="text",
    placeholder="login.salesforce.com",
    hint="test.salesforce.com for a sandbox, or your My Domain host.",
    max_length=253,
)

_DATABRICKS_HOST = CredentialFieldSpec(
    key="serverHostname",
    label="Server hostname",
    sensitivity="public",
    input="text",
    placeholder="dbc-00000000-0000.cloud.databricks.com",
    hint="SQL Warehouse → Connection details → Server hostname. No https://.",
    max_length=253,
)

_DATABRICKS_HTTP_PATH = CredentialFieldSpec(
    key="httpPath",
    label="HTTP path",
    sensitivity="public",
    input="text",
    placeholder="/sql/1.0/warehouses/0000000000000000",
    hint="Same panel as the hostname.",
    max_length=255,
)

_SNOWFLAKE_SHAPE = [
    CredentialFieldSpec(
        key="account",
        label="Account identifier",
        sensitivity="public",
        input="text",
        placeholder="ORGNAME-ACCOUNTNAME",
        hint="Not the full URL — just the identifier.",
        max_length=255,
    ),
    CredentialFieldSpec(
        key="user", label="User", sensitivity="public", input="text",
        placeholder="CANON_SVC", max_length=255,
    ),
    CredentialFieldSpec(
        key="warehouse", label="Warehouse", sensitivity="public", input="text",
        placeholder="COMPUTE_WH", max_length=255,
    ),
    CredentialFieldSpec(
        key="role",
        label="Role",
        sensitivity="public",
        input="text",
        placeholder="CANON_READER",
        hint="Optional. A read-only role is the right one — Canon never writes back.",
        optional=True,
        max_length=255,
    ),
]


# ── The schema ───────────────────────────────────────────────────────────────

CREDENTIAL_SCHEMA: dict[SourceKind, PlatformCredentialSpec] = {
    "salesforce": PlatformCredentialSpec(
        kind="salesforce",
        label="Salesforce",
        methods=[
            AuthMethodSpec(
                method="oauth2",
                label="OAuth · Connected App",
                summary=(
                    "You sign in at Salesforce. Canon receives a scoped refresh token "
                    "and never sees your password."
                ),
                fields=[_SALESFORCE_LOGIN_HOST],
                oauth=OAuthSpec(
                    authorize_url="https://{loginHost}/services/oauth2/authorize",
                    token_url="https://{loginHost}/services/oauth2/token",
                    scopes=["api", "refresh_token", "offline_access"],
                    pkce=True,
                    client_id_env="SALESFORCE_OAUTH_CLIENT_ID",
                    client_secret_env="SALESFORCE_OAUTH_CLIENT_SECRET",
                ),
            ),
            AuthMethodSpec(
                method="password",
                label="Username · password · security token",
                summary=(
                    "The SOAP-era flow. Works without a Connected App, but Canon holds "
                    "a reusable password — prefer OAuth."
                ),
                fields=[
                    _SALESFORCE_LOGIN_HOST,
                    CredentialFieldSpec(
                        key="username", label="Username", sensitivity="public",
                        input="text", placeholder="svc.canon@example.com", max_length=255,
                    ),
                    CredentialFieldSpec(
                        key="password", label="Password", sensitivity="secret",
                        input="password", max_length=255,
                    ),
                    CredentialFieldSpec(
                        key="securityToken",
                        label="Security token",
                        sensitivity="secret",
                        input="password",
                        hint=(
                            "Emailed by Salesforce when the password is reset. "
                            "Blank if your IP is allowlisted."
                        ),
                        optional=True,
                        max_length=255,
                    ),
                ],
            ),
        ],
    ),
    "hubspot": PlatformCredentialSpec(
        kind="hubspot",
        label="HubSpot",
        methods=[
            AuthMethodSpec(
                method="oauth2",
                label="OAuth · HubSpot app",
                summary=(
                    "You pick the portal at HubSpot. Canon receives a refresh token "
                    "scoped to reads."
                ),
                oauth=OAuthSpec(
                    authorize_url="https://app.hubspot.com/oauth/authorize",
                    token_url="https://api.hubapi.com/oauth/v1/token",
                    scopes=[
                        "crm.objects.companies.read",
                        "crm.objects.owners.read",
                        "settings.users.read",
                    ],
                    # HubSpot's token endpoint authenticates with the client
                    # secret and rejects a code_verifier.
                    pkce=False,
                    client_id_env="HUBSPOT_OAUTH_CLIENT_ID",
                    client_secret_env="HUBSPOT_OAUTH_CLIENT_SECRET",
                ),
            ),
            AuthMethodSpec(
                method="token",
                label="Private app token",
                summary="A long-lived token from Settings → Integrations → Private apps.",
                fields=[
                    CredentialFieldSpec(
                        key="accessToken", label="Access token", sensitivity="secret",
                        input="password", placeholder="pat-na1-…", max_length=255,
                    ),
                ],
            ),
        ],
    ),
    "databricks": PlatformCredentialSpec(
        kind="databricks",
        label="Databricks",
        methods=[
            AuthMethodSpec(
                method="oauth2",
                label="OAuth · user to machine",
                summary=(
                    "You sign in to the workspace. Canon receives a refresh token bound "
                    "to your SQL warehouse."
                ),
                fields=[_DATABRICKS_HOST, _DATABRICKS_HTTP_PATH],
                oauth=OAuthSpec(
                    authorize_url="https://{serverHostname}/oidc/v1/authorize",
                    token_url="https://{serverHostname}/oidc/v1/token",
                    scopes=["sql", "offline_access"],
                    pkce=True,
                    # U2M is a public client: PKCE is the proof, there is no
                    # secret to hold.
                    client_id_env="DATABRICKS_OAUTH_CLIENT_ID",
                ),
            ),
            AuthMethodSpec(
                method="token",
                label="Personal access token",
                summary=(
                    "A workspace PAT. Simplest to provision, and it does not expire "
                    "on its own."
                ),
                fields=[
                    _DATABRICKS_HOST,
                    _DATABRICKS_HTTP_PATH,
                    CredentialFieldSpec(
                        key="accessToken",
                        label="Access token",
                        sensitivity="secret",
                        input="password",
                        placeholder="dapi…",
                        hint="Settings → Developer → Access tokens.",
                        max_length=255,
                    ),
                ],
            ),
        ],
    ),
    "snowflake": PlatformCredentialSpec(
        kind="snowflake",
        label="Snowflake",
        methods=[
            AuthMethodSpec(
                method="keypair",
                label="Key pair",
                summary=(
                    "Snowflake's own recommendation for service accounts. Canon holds "
                    "a private key, never a password."
                ),
                fields=[
                    *_SNOWFLAKE_SHAPE,
                    CredentialFieldSpec(
                        key="privateKey",
                        label="Private key · PEM",
                        sensitivity="secret",
                        input="textarea",
                        placeholder="-----BEGIN PRIVATE KEY-----",
                        hint="The whole PEM block, including both delimiter lines.",
                        max_length=8192,
                    ),
                    CredentialFieldSpec(
                        key="privateKeyPassphrase",
                        label="Key passphrase",
                        sensitivity="secret",
                        input="password",
                        hint="Only if the key was generated encrypted.",
                        optional=True,
                        max_length=255,
                    ),
                ],
            ),
            AuthMethodSpec(
                method="oauth2",
                label="OAuth · security integration",
                summary=(
                    "Requires an EXTERNAL OAUTH or CUSTOM security integration on the "
                    "account."
                ),
                fields=list(_SNOWFLAKE_SHAPE),
                oauth=OAuthSpec(
                    authorize_url="https://{account}.snowflakecomputing.com/oauth/authorize",
                    token_url="https://{account}.snowflakecomputing.com/oauth/token-request",
                    scopes=["refresh_token", "session:role:{role}"],
                    pkce=True,
                    client_id_env="SNOWFLAKE_OAUTH_CLIENT_ID",
                    client_secret_env="SNOWFLAKE_OAUTH_CLIENT_SECRET",
                ),
            ),
            AuthMethodSpec(
                method="password",
                label="Username · password",
                summary="Works everywhere, ages badly. Prefer a key pair.",
                fields=[
                    *_SNOWFLAKE_SHAPE,
                    CredentialFieldSpec(
                        key="password", label="Password", sensitivity="secret",
                        input="password", max_length=255,
                    ),
                ],
            ),
        ],
    ),
    "synthetic": PlatformCredentialSpec(
        kind="synthetic",
        label="Synthetic",
        methods=[
            AuthMethodSpec(
                method="none",
                label="No credentials",
                summary=(
                    "Generated locally from a seed by eval/generate.py. There is "
                    "nothing to authenticate against."
                ),
            ),
        ],
    ),
}


def find_auth_method(kind: SourceKind, method: AuthMethod) -> AuthMethodSpec | None:
    """``None`` rather than a raise: an unknown pair is bad data, not a crash."""
    return next((m for m in CREDENTIAL_SCHEMA[kind].methods if m.method == method), None)


def default_auth_method(kind: SourceKind) -> AuthMethod:
    """The recommended method — first in the list."""
    return CREDENTIAL_SCHEMA[kind].methods[0].method


def requires_credentials(kind: SourceKind) -> bool:
    return default_auth_method(kind) != "none"


def render_template(template: str, values: dict[str, str]) -> str:
    """``https://{serverHostname}/oidc/v1/token`` → a real URL.

    Deliberately not ``str.format``: a public value containing a stray brace
    would raise there, and this runs on user-supplied hostnames.
    """
    out = template
    for key, value in values.items():
        out = out.replace("{" + key + "}", value)
    return out


# ── The stored row, still sealed ─────────────────────────────────────────────


class SealedCredentialRow(CanonModel):
    """A ``source_credentials`` row exactly as Postgres holds it.

    Deliberately a separate type from ``SourceCredentials``: this one is safe to
    pass around, log a repr of, and hold indefinitely, because every secret in
    it is ciphertext. The moment it becomes ``SourceCredentials`` it is
    plaintext and none of that is true any more. Two types make that transition
    visible in a signature instead of implicit.
    """

    source_id: UUID
    method: AuthMethod
    #: Non-secret connection shape, stored in clear.
    public_values: dict[str, str] = Field(default_factory=dict)
    #: Base64 AES-256-GCM ciphertext, nonce and tag.
    ciphertext: str
    iv: str
    auth_tag: str
    #: Which root key generation sealed this row.
    key_version: int = 1
    expires_at: datetime | None = None
    scope: str | None = None


# ── The decrypted payload ────────────────────────────────────────────────────


class SourceCredentials(CanonModel):
    """One source's credentials, decrypted, in memory, for the length of a run.

    Never logged, never written back to Postgres, never returned over HTTP.
    ``__str__`` and ``__repr__`` are overridden below because the single most
    likely way a secret escapes a Python service is an exception traceback that
    happens to render a model.
    """

    source_id: UUID
    kind: SourceKind
    method: AuthMethod
    #: Connection shape — hostnames, HTTP paths, warehouse names.
    public_values: dict[str, str] = Field(default_factory=dict)
    #: Tokens, passwords, private keys. The reason this whole feature exists.
    secret_values: dict[str, str] = Field(default_factory=dict, repr=False)
    #: OAuth only. When ``access_token`` in ``secret_values`` stops working.
    expires_at: datetime | None = None
    scope: str | None = None

    @model_validator(mode="after")
    def _matches_the_schema(self) -> SourceCredentials:
        """A credential that does not fit its own spec is corrupt, not usable.

        Worth failing loudly here rather than three stack frames into a
        connector: "Salesforce credential is missing loginHost" is actionable,
        and ``KeyError: 'loginHost'`` inside simple-salesforce is not.
        """
        spec = find_auth_method(self.kind, self.method)
        if spec is None:
            raise ValueError(f"{self.kind} does not support auth method {self.method}")

        present = set(self.public_values) | set(self.secret_values)

        # OAuth mints its own keys at the callback — they are not form fields,
        # so they are not in `fields` and must not be required to be.
        if self.method == "oauth2":
            if "refreshToken" not in self.secret_values and "accessToken" not in self.secret_values:
                raise ValueError(f"{self.kind} OAuth credential carries no token")
            present -= {"refreshToken", "accessToken"}

        missing = spec.required_keys - present
        if missing:
            raise ValueError(
                f"{self.kind} {self.method} credential is missing {sorted(missing)}"
            )

        return self

    def secret(self, key: str) -> str:
        """A secret by key, with a message that names the source when it is absent."""
        try:
            return self.secret_values[key]
        except KeyError as error:
            raise KeyError(
                f"Source {self.source_id} ({self.kind}/{self.method}) has no secret {key!r}."
            ) from error

    def public(self, key: str, default: str = "") -> str:
        return self.public_values.get(key, default)

    def __str__(self) -> str:
        return f"SourceCredentials({self.kind}/{self.method}, source_id={self.source_id})"

    def __repr__(self) -> str:
        return self.__str__()
