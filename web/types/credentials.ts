import { z } from "zod";
import { sourceKindSchema, type SourceKind } from "@/types/source";

/**
 * The credential contract — mirrors engine/pipeline/credentials.py exactly.
 * Change one without the other and a source that saves fine will fail to
 * connect, which is the worst possible place to discover a schema drift.
 *
 * This file is the single declaration of "what does connecting to X require".
 * Three things read it and nothing hand-maintains a second copy:
 *
 *   the form      renders one input per field in `fields`
 *   the route     builds its Zod body schema from the same `fields`
 *   the engine    knows which keys to expect after decrypting
 *
 * Adding a platform is editing `CREDENTIAL_SCHEMA` and its Python mirror.
 * There is no third place.
 *
 * WHAT IS NOT HERE: values. This module describes the *shape* of a credential
 * and nothing else. It is imported by Client Components, so a secret appearing
 * in it would ship to the browser.
 */

/**
 * How a source proves who it is.
 *
 * `oauth2` is listed first for every platform that supports it and is what the
 * UI defaults to, because it is the only method here where Canon never holds a
 * reusable password: the user authenticates at their own provider, and what
 * comes back is a scoped, revocable, expiring grant. The others exist because
 * a Databricks PAT or a Snowflake key pair is still how most service accounts
 * are actually provisioned, and refusing to support them would push people
 * back to sharing a human's login.
 */
export const authMethodSchema = z.enum([
  /** Authorization code + PKCE. Canon stores a refresh token, never a password. */
  "oauth2",
  /** A single long-lived token — Databricks PAT, HubSpot private app token. */
  "token",
  /** Username + password (+ a security token on Salesforce). Legacy. */
  "password",
  /** Account + user + RSA private key. Snowflake service accounts. */
  "keypair",
  /** Nothing to authenticate — the synthetic connector reads generated files. */
  "none",
]);

export type AuthMethod = z.infer<typeof authMethodSchema>;

/**
 * Whether a field's value is a secret.
 *
 * This is the single most load-bearing property in the file. It decides
 * everything downstream: `secret` fields are encrypted at rest, never returned
 * by any read path, and rendered write-only; `public` fields are stored in
 * clear because they are connection *shape* — a hostname, an HTTP path, a
 * warehouse name — and the console has to be able to show them back.
 *
 * When in doubt, mark it `secret`. A hostname stored as a secret is a mild
 * inconvenience; a token stored as public is an incident.
 */
export type FieldSensitivity = "secret" | "public";

/** How the field renders. `password` and `textarea` are both secret-shaped. */
export type FieldInput = "text" | "password" | "textarea";

export type CredentialFieldSpec = {
  /** The key this lands under in the credential payload. */
  key: string;
  label: string;
  sensitivity: FieldSensitivity;
  input: FieldInput;
  /** Shown in the empty control. Never a real-looking value someone might submit. */
  placeholder?: string;
  /** One line under the field — where to find this value in the provider's UI. */
  hint?: string;
  optional?: boolean;
  /** Longest accepted value. PEM keys are long; a hostname is not. */
  maxLength?: number;
};

/**
 * An OAuth 2.0 provider, described rather than coded.
 *
 * `authorizeUrl` and `tokenUrl` are templates: `{key}` is substituted from the
 * method's own public fields, which is what lets one declaration cover a
 * Salesforce sandbox and a production org, or any Databricks workspace, without
 * a branch anywhere in the flow.
 */
export type OAuthSpec = {
  /** `https://{loginHost}/services/oauth2/authorize` — `{}` filled from public fields. */
  authorizeUrl: string;
  tokenUrl: string;
  /** Requested scopes. Keep these minimal — Canon only ever reads. */
  scopes: string[];
  /**
   * PKCE (RFC 7636). True everywhere it is supported, which is everywhere here
   * except HubSpot, whose token endpoint still authenticates with the client
   * secret alone.
   */
  pkce: boolean;
  /**
   * The env vars holding Canon's *app* registration with this provider. These
   * are per-deployment, not per-user, and they live in web/.env because the
   * whole OAuth dance is browser-driven and never touches the engine.
   */
  clientIdEnv: string;
  clientSecretEnv?: string;
  /** Extra authorize-time params — `prompt`, `access_type`, and friends. */
  extraAuthorizeParams?: Record<string, string>;
};

export type AuthMethodSpec = {
  method: AuthMethod;
  label: string;
  /** One line under the method selector. Says what the user is about to hand over. */
  summary: string;
  /**
   * Fields collected in the form. For an OAuth method these are all `public`
   * and are gathered *before* the redirect, because the authorize URL is built
   * from them. The secret half of an OAuth grant never passes through a form.
   */
  fields: CredentialFieldSpec[];
  oauth?: OAuthSpec;
};

export type PlatformCredentialSpec = {
  kind: SourceKind;
  label: string;
  /** Ordered. The first entry is the recommended method and the UI's default. */
  methods: AuthMethodSpec[];
};

// ── Field fragments reused across platforms ──────────────────────────────────

const SALESFORCE_LOGIN_HOST: CredentialFieldSpec = {
  key: "loginHost",
  label: "Login host",
  sensitivity: "public",
  input: "text",
  placeholder: "login.salesforce.com",
  hint: "test.salesforce.com for a sandbox, or your My Domain host.",
  maxLength: 253,
};

const DATABRICKS_HOST: CredentialFieldSpec = {
  key: "serverHostname",
  label: "Server hostname",
  sensitivity: "public",
  input: "text",
  placeholder: "dbc-00000000-0000.cloud.databricks.com",
  hint: "SQL Warehouse → Connection details → Server hostname. No https://.",
  maxLength: 253,
};

const DATABRICKS_HTTP_PATH: CredentialFieldSpec = {
  key: "httpPath",
  label: "HTTP path",
  sensitivity: "public",
  input: "text",
  placeholder: "/sql/1.0/warehouses/0000000000000000",
  hint: "Same panel as the hostname.",
  maxLength: 255,
};

/** Account · user · warehouse · role — Snowflake's non-secret half, shared by all three methods. */
const SNOWFLAKE_SHAPE: CredentialFieldSpec[] = [
  {
    key: "account",
    label: "Account identifier",
    sensitivity: "public",
    input: "text",
    placeholder: "ORGNAME-ACCOUNTNAME",
    hint: "Not the full URL — just the identifier.",
    maxLength: 255,
  },
  {
    key: "user",
    label: "User",
    sensitivity: "public",
    input: "text",
    placeholder: "CANON_SVC",
    maxLength: 255,
  },
  {
    key: "warehouse",
    label: "Warehouse",
    sensitivity: "public",
    input: "text",
    placeholder: "COMPUTE_WH",
    maxLength: 255,
  },
  {
    key: "role",
    label: "Role",
    sensitivity: "public",
    input: "text",
    placeholder: "CANON_READER",
    hint: "Optional. A read-only role is the right one — Canon never writes back.",
    optional: true,
    maxLength: 255,
  },
];

// ── The schema ───────────────────────────────────────────────────────────────

/**
 * Every supported platform, every way of connecting to it.
 *
 * Read this as policy, not as a list of integrations: it is where the decision
 * "Canon asks for a refresh token, not your password" is actually written down.
 */
export const CREDENTIAL_SCHEMA: Record<SourceKind, PlatformCredentialSpec> = {
  salesforce: {
    kind: "salesforce",
    label: "Salesforce",
    methods: [
      {
        method: "oauth2",
        label: "OAuth · Connected App",
        summary:
          "You sign in at Salesforce. Canon receives a scoped refresh token and never sees your password.",
        fields: [SALESFORCE_LOGIN_HOST],
        oauth: {
          authorizeUrl: "https://{loginHost}/services/oauth2/authorize",
          tokenUrl: "https://{loginHost}/services/oauth2/token",
          // `api` to read; `refresh_token`/`offline_access` so a nightly run
          // does not need someone at a keyboard.
          scopes: ["api", "refresh_token", "offline_access"],
          pkce: true,
          clientIdEnv: "SALESFORCE_OAUTH_CLIENT_ID",
          clientSecretEnv: "SALESFORCE_OAUTH_CLIENT_SECRET",
        },
      },
      {
        method: "password",
        label: "Username · password · security token",
        summary:
          "The SOAP-era flow. Works without a Connected App, but Canon holds a reusable password — prefer OAuth.",
        fields: [
          SALESFORCE_LOGIN_HOST,
          {
            key: "username",
            label: "Username",
            sensitivity: "public",
            input: "text",
            placeholder: "svc.canon@example.com",
            maxLength: 255,
          },
          {
            key: "password",
            label: "Password",
            sensitivity: "secret",
            input: "password",
            maxLength: 255,
          },
          {
            key: "securityToken",
            label: "Security token",
            sensitivity: "secret",
            input: "password",
            hint: "Emailed by Salesforce when the password is reset. Blank if your IP is allowlisted.",
            optional: true,
            maxLength: 255,
          },
        ],
      },
    ],
  },

  hubspot: {
    kind: "hubspot",
    label: "HubSpot",
    methods: [
      {
        method: "oauth2",
        label: "OAuth · HubSpot app",
        summary: "You pick the portal at HubSpot. Canon receives a refresh token scoped to reads.",
        fields: [],
        oauth: {
          authorizeUrl: "https://app.hubspot.com/oauth/authorize",
          tokenUrl: "https://api.hubapi.com/oauth/v1/token",
          scopes: ["crm.objects.companies.read", "crm.objects.owners.read", "settings.users.read"],
          // HubSpot's token endpoint authenticates with the client secret and
          // rejects a code_verifier. The one provider here without PKCE.
          pkce: false,
          clientIdEnv: "HUBSPOT_OAUTH_CLIENT_ID",
          clientSecretEnv: "HUBSPOT_OAUTH_CLIENT_SECRET",
        },
      },
      {
        method: "token",
        label: "Private app token",
        summary: "A long-lived token from Settings → Integrations → Private apps.",
        fields: [
          {
            key: "accessToken",
            label: "Access token",
            sensitivity: "secret",
            input: "password",
            placeholder: "pat-na1-…",
            maxLength: 255,
          },
        ],
      },
    ],
  },

  databricks: {
    kind: "databricks",
    label: "Databricks",
    methods: [
      {
        method: "oauth2",
        label: "OAuth · user to machine",
        summary:
          "You sign in to the workspace. Canon receives a refresh token bound to your SQL warehouse.",
        fields: [DATABRICKS_HOST, DATABRICKS_HTTP_PATH],
        oauth: {
          authorizeUrl: "https://{serverHostname}/oidc/v1/authorize",
          tokenUrl: "https://{serverHostname}/oidc/v1/token",
          scopes: ["sql", "offline_access"],
          pkce: true,
          // Databricks U2M is a public client: PKCE is the proof, there is no
          // secret to hold, so `clientSecretEnv` is deliberately absent.
          clientIdEnv: "DATABRICKS_OAUTH_CLIENT_ID",
        },
      },
      {
        method: "token",
        label: "Personal access token",
        summary: "A workspace PAT. Simplest to provision, and it does not expire on its own.",
        fields: [
          DATABRICKS_HOST,
          DATABRICKS_HTTP_PATH,
          {
            key: "accessToken",
            label: "Access token",
            sensitivity: "secret",
            input: "password",
            placeholder: "dapi…",
            hint: "Settings → Developer → Access tokens.",
            maxLength: 255,
          },
        ],
      },
    ],
  },

  snowflake: {
    kind: "snowflake",
    label: "Snowflake",
    methods: [
      {
        method: "keypair",
        label: "Key pair",
        summary:
          "Snowflake's own recommendation for service accounts. Canon holds a private key, never a password.",
        fields: [
          ...SNOWFLAKE_SHAPE,
          {
            key: "privateKey",
            label: "Private key · PEM",
            sensitivity: "secret",
            input: "textarea",
            placeholder: "-----BEGIN PRIVATE KEY-----",
            hint: "The whole PEM block, including both delimiter lines.",
            maxLength: 8192,
          },
          {
            key: "privateKeyPassphrase",
            label: "Key passphrase",
            sensitivity: "secret",
            input: "password",
            hint: "Only if the key was generated encrypted.",
            optional: true,
            maxLength: 255,
          },
        ],
      },
      {
        method: "oauth2",
        label: "OAuth · security integration",
        summary:
          "Requires an EXTERNAL OAUTH or CUSTOM security integration on the account.",
        fields: SNOWFLAKE_SHAPE,
        oauth: {
          authorizeUrl: "https://{account}.snowflakecomputing.com/oauth/authorize",
          tokenUrl: "https://{account}.snowflakecomputing.com/oauth/token-request",
          scopes: ["refresh_token", "session:role:{role}"],
          pkce: true,
          clientIdEnv: "SNOWFLAKE_OAUTH_CLIENT_ID",
          clientSecretEnv: "SNOWFLAKE_OAUTH_CLIENT_SECRET",
        },
      },
      {
        method: "password",
        label: "Username · password",
        summary: "Works everywhere, ages badly. Prefer a key pair.",
        fields: [
          ...SNOWFLAKE_SHAPE,
          {
            key: "password",
            label: "Password",
            sensitivity: "secret",
            input: "password",
            maxLength: 255,
          },
        ],
      },
    ],
  },

  synthetic: {
    kind: "synthetic",
    label: "Synthetic",
    methods: [
      {
        method: "none",
        label: "No credentials",
        summary:
          "Generated locally from a seed by engine/eval/generate.py. There is nothing to authenticate against.",
        fields: [],
      },
    ],
  },
};

// ── Lookups ──────────────────────────────────────────────────────────────────

/** The recommended method — first in the list, and what the form opens on. */
export function defaultAuthMethod(kind: SourceKind): AuthMethod {
  return CREDENTIAL_SCHEMA[kind].methods[0].method;
}

export function authMethodsFor(kind: SourceKind): AuthMethodSpec[] {
  return CREDENTIAL_SCHEMA[kind].methods;
}

/**
 * Returns null rather than throwing for an unsupported pair, so a route handler
 * can answer 400 instead of 500. A client naming `keypair` on `hubspot` is a bad
 * request, not a server fault.
 */
export function findAuthMethod(kind: SourceKind, method: AuthMethod): AuthMethodSpec | null {
  return CREDENTIAL_SCHEMA[kind].methods.find((spec) => spec.method === method) ?? null;
}

/** Whether this platform needs anything at all. Only `synthetic` does not. */
export function requiresCredentials(kind: SourceKind): boolean {
  return defaultAuthMethod(kind) !== "none";
}

export function secretFields(spec: AuthMethodSpec): CredentialFieldSpec[] {
  return spec.fields.filter((field) => field.sensitivity === "secret");
}

export function publicFields(spec: AuthMethodSpec): CredentialFieldSpec[] {
  return spec.fields.filter((field) => field.sensitivity === "public");
}

// ── Validation, built from the same field list the form renders ──────────────

/**
 * The Zod schema for one (kind, method)'s values, derived from `fields`.
 *
 * Derived, not written twice: a hand-maintained schema next to a hand-maintained
 * field list drifts the first time someone adds a field to one of them, and the
 * failure mode is a value the form collects and the server silently drops.
 *
 * Unknown keys are rejected rather than stripped. A client sending `password`
 * on an OAuth method has misunderstood something, and quietly discarding it
 * would leave them believing a secret was stored when it was not.
 */
export function credentialValuesSchema(spec: AuthMethodSpec) {
  const shape: Record<string, z.ZodType<string | undefined>> = {};

  for (const field of spec.fields) {
    const max = field.maxLength ?? 1024;
    shape[field.key] = field.optional
      ? z.string().trim().max(max).optional()
      : z.string().trim().min(1, `${field.label} is required.`).max(max);
  }

  return z.strictObject(shape);
}

/**
 * PUT /api/sources/:sourceId/credentials.
 *
 * Two-stage on purpose: `kind` + `method` select a spec, and only then can the
 * values be checked against it. `superRefine` is where the second stage runs,
 * so one parse either yields fully validated values or a field-addressable
 * error — the same contract every other route handler in the console has.
 */
export const storeCredentialsSchema = z
  .object({
    kind: sourceKindSchema,
    method: authMethodSchema,
    values: z.record(z.string(), z.string()),
  })
  .superRefine((body, ctx) => {
    const spec = findAuthMethod(body.kind, body.method);

    if (!spec) {
      ctx.addIssue({
        code: "custom",
        path: ["method"],
        message: `${CREDENTIAL_SCHEMA[body.kind].label} does not support ${body.method}.`,
      });
      return;
    }

    // An OAuth grant is minted by the callback, not posted by a browser. If
    // this route accepted one, the whole point of the redirect — that Canon
    // never handles a credential the user typed into Canon — would be gone.
    if (spec.method === "oauth2") {
      ctx.addIssue({
        code: "custom",
        path: ["method"],
        message: "OAuth credentials are established by the authorize flow, not by this endpoint.",
      });
      return;
    }

    const parsed = credentialValuesSchema(spec).safeParse(body.values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ["values", ...issue.path] });
      }
    }
  });

export type StoreCredentials = z.infer<typeof storeCredentialsSchema>;

// ── What a read path is allowed to return ────────────────────────────────────

/**
 * The redacted view — the only shape any GET returns.
 *
 * There is deliberately no endpoint, anywhere, that returns a stored secret.
 * The console shows that a credential exists, which method it uses, when it was
 * last verified and when it expires; it never shows the value, not even masked,
 * because a masked value still travels over the wire to get masked.
 */
export const credentialStatusSchema = z.object({
  sourceId: z.string().uuid(),
  method: authMethodSchema,
  /** Non-secret connection shape — hostnames, paths, warehouse names. */
  publicValues: z.record(z.string(), z.string()),
  /** Which secret keys are present. Names only, never values. */
  secretKeys: z.array(z.string()),
  /** OAuth only: when the access token dies and the refresh token is used. */
  expiresAt: z.coerce.date().nullable(),
  scope: z.string().nullable(),
  /** Last successful connection, from the engine's own preflight. */
  lastVerifiedAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date(),
  /** Clerk user id of whoever connected it. Answers "whose grant is this?". */
  connectedBy: z.string(),
});

export type CredentialStatus = z.infer<typeof credentialStatusSchema>;

export const AUTH_METHOD_LABEL: Record<AuthMethod, string> = {
  oauth2: "OAuth",
  token: "Token",
  password: "Password",
  keypair: "Key pair",
  none: "None",
};
