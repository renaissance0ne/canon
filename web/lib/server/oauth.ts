import "server-only";
import {
  openToken,
  pkceChallenge,
  randomToken,
  safeEqual,
  sealToken,
} from "@/lib/server/crypto";
import {
  findAuthMethod,
  publicFields,
  type AuthMethodSpec,
  type OAuthSpec,
} from "@/types/credentials";
import type { SourceKind } from "@/types/source";

/**
 * OAuth 2.0 authorization code flow with PKCE. SERVER ONLY.
 *
 * This is the preferred way to connect every platform that supports it, and the
 * reason is narrow and worth stating: in every other method Canon ends up
 * holding a credential the user typed into Canon. Here it holds a grant the
 * provider minted, scoped to reads, revocable from the provider's own UI
 * without Canon's involvement, and useless anywhere else.
 *
 * Nothing in this file is provider-specific. Everything that differs between
 * Salesforce, HubSpot, Databricks and Snowflake is data in
 * `@/types/credentials`, which is what keeps "add a platform" from meaning
 * "add a branch to the OAuth flow".
 *
 * THE COOKIE
 * `state` and the PKCE `code_verifier` have to survive a redirect to a third
 * party and back. They travel in one sealed, httpOnly, SameSite=Lax cookie —
 * Lax rather than Strict because the callback arrives as a cross-site
 * navigation and Strict would withhold the cookie exactly when it is needed.
 */

const STATE_COOKIE = "canon_oauth_state";
/** Long enough for a real sign-in with MFA, short enough that a stale tab fails closed. */
const STATE_TTL_SECONDS = 600;

export { STATE_COOKIE, STATE_TTL_SECONDS };

/** Canon's app registration with a provider, resolved from the environment. */
type OAuthClient = { id: string; secret: string | null };

export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthConfigError";
  }
}

export class OAuthExchangeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OAuthExchangeError";
  }
}

/**
 * The OAuth spec for a (kind, method), or a typed error naming what is missing.
 *
 * A missing client id is a deployment problem, not a user problem, and the
 * message says which env var to set — an operator reading "OAuth failed" learns
 * nothing.
 */
export function resolveOAuth(
  kind: SourceKind,
  method: AuthMethodSpec["method"],
): { spec: AuthMethodSpec; oauth: OAuthSpec; client: OAuthClient } {
  const spec = findAuthMethod(kind, method);
  if (!spec?.oauth) {
    throw new OAuthConfigError(`${kind} has no OAuth method named ${method}.`);
  }

  const id = process.env[spec.oauth.clientIdEnv];
  if (!id) {
    throw new OAuthConfigError(
      `${spec.oauth.clientIdEnv} is not set. Register Canon as an app with ${kind} and ` +
        `add the client id to web/.env — this is a per-deployment value, not a per-user one.`,
    );
  }

  const secretEnv = spec.oauth.clientSecretEnv;
  const secret = secretEnv ? (process.env[secretEnv] ?? null) : null;

  if (secretEnv && !secret) {
    throw new OAuthConfigError(`${secretEnv} is not set, but ${kind} requires a client secret.`);
  }

  return { spec, oauth: spec.oauth, client: { id, secret } };
}

/** Whether this deployment can offer OAuth for a platform, without throwing. */
export function oauthConfigured(kind: SourceKind, method: AuthMethodSpec["method"]): boolean {
  try {
    resolveOAuth(kind, method);
    return true;
  } catch {
    return false;
  }
}

/**
 * The redirect URI, which must match what is registered at the provider
 * character for character.
 *
 * Read from `CANON_APP_URL` rather than the incoming request's Host header:
 * Host is attacker-controllable, and a redirect URI derived from it is the
 * classic way an authorization code ends up delivered somewhere else. The
 * request origin is a fallback for local development only.
 */
export function redirectUri(kind: SourceKind, requestUrl: string): string {
  const configured = process.env.CANON_APP_URL;
  const base = configured ?? new URL(requestUrl).origin;
  return `${base.replace(/\/+$/, "")}/api/oauth/${kind}/callback`;
}

/** `{key}` substitution from the method's public values. */
function render(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (out, [key, value]) => out.split(`{${key}}`).join(value),
    template,
  );
}

export type AuthorizeStart = {
  /** Where the browser is sent. */
  authorizeUrl: string;
  /** The sealed cookie value that must accompany it. */
  state: string;
};

/**
 * Build the authorize redirect and the state that proves the callback belongs
 * to it.
 *
 * `publicValues` is carried inside the sealed state rather than round-tripped
 * through the provider. A provider that echoes back a hostname Canon then
 * connects to is a provider that can point Canon at any host it likes.
 */
export function startAuthorization(input: {
  kind: SourceKind;
  sourceId: string;
  publicValues: Record<string, string>;
  requestUrl: string;
}): AuthorizeStart {
  const { oauth, client } = resolveOAuth(input.kind, "oauth2");

  const stateNonce = randomToken();
  const verifier = oauth.pkce ? randomToken(64) : null;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.id,
    redirect_uri: redirectUri(input.kind, input.requestUrl),
    scope: render(oauth.scopes.join(" "), input.publicValues),
    state: stateNonce,
    ...oauth.extraAuthorizeParams,
  });

  if (verifier) {
    params.set("code_challenge", pkceChallenge(verifier));
    params.set("code_challenge_method", "S256");
  }

  const authorizeUrl = `${render(oauth.authorizeUrl, input.publicValues)}?${params.toString()}`;

  return {
    authorizeUrl,
    state: sealToken(
      {
        nonce: stateNonce,
        kind: input.kind,
        sourceId: input.sourceId,
        // JSON inside JSON: the sealed payload is a flat string map, and this
        // is the one field that is not naturally flat.
        publicValues: JSON.stringify(input.publicValues),
        ...(verifier ? { verifier } : {}),
      },
      "oauth-state",
    ),
  };
}

export type PendingAuthorization = {
  kind: SourceKind;
  sourceId: string;
  publicValues: Record<string, string>;
  verifier: string | null;
};

/**
 * Open the state cookie and check it against the `state` the provider returned.
 *
 * This is the CSRF check, and it is the reason the flow is safe to expose as a
 * plain GET: without it, an attacker can hand a signed-in user a callback URL
 * carrying the attacker's own authorization code, and Canon would faithfully
 * store the attacker's account as that user's source. Compared in constant
 * time, and a mismatch returns null rather than explaining which half was wrong.
 */
export function verifyState(
  cookieValue: string | undefined,
  returnedState: string | null,
  kind: SourceKind,
): PendingAuthorization | null {
  if (!cookieValue || !returnedState) return null;

  const opened = openToken(cookieValue, "oauth-state");
  if (!opened) return null;

  if (!safeEqual(opened.nonce ?? "", returnedState)) return null;
  // The callback path names a platform; the sealed state names one too. A
  // mismatch means the cookie was minted for a different flow.
  if (opened.kind !== kind) return null;
  if (!opened.sourceId) return null;

  let publicValues: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(opened.publicValues ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      publicValues = parsed as Record<string, string>;
    }
  } catch {
    return null;
  }

  return {
    kind,
    sourceId: opened.sourceId,
    publicValues,
    verifier: opened.verifier ?? null,
  };
}

export type TokenGrant = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
};

/** How long to wait on a provider's token endpoint before giving up. */
const TOKEN_TIMEOUT_MS = 10_000;

/**
 * Exchange an authorization code for tokens.
 *
 * Also the refresh path — `grant_type` is the only difference, so both live
 * here rather than in two near-identical functions that drift.
 */
export async function exchangeCode(
  pending: PendingAuthorization,
  code: string,
  requestUrl: string,
): Promise<TokenGrant> {
  const { oauth, client } = resolveOAuth(pending.kind, "oauth2");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: client.id,
    redirect_uri: redirectUri(pending.kind, requestUrl),
  });

  if (client.secret) body.set("client_secret", client.secret);
  if (pending.verifier) body.set("code_verifier", pending.verifier);

  return postToken(render(oauth.tokenUrl, pending.publicValues), body);
}

async function postToken(url: string, body: URLSearchParams): Promise<TokenGrant> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    throw new OAuthExchangeError("The provider's token endpoint did not respond.", { cause });
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // OAuth errors are a defined shape (RFC 6749 §5.2) and the description is
    // the only thing that makes a failed connect fixable. The code itself is
    // never in the response, so this is safe to surface.
    const described = describeOAuthError(payload);
    throw new OAuthExchangeError(
      `The provider rejected the exchange (${response.status})${described ? `: ${described}` : "."}`,
    );
  }

  return readGrant(payload);
}

function readGrant(payload: unknown): TokenGrant {
  if (!payload || typeof payload !== "object") {
    throw new OAuthExchangeError("The provider returned a token response that was not an object.");
  }

  const body = payload as Record<string, unknown>;
  const accessToken = body.access_token;

  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new OAuthExchangeError("The provider's token response carried no access_token.");
  }

  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null;
  const scope = typeof body.scope === "string" ? body.scope : null;

  // `expires_in` is seconds from now. Stamped to an absolute time here, because
  // a relative lifetime stored in a row means nothing once the row is read.
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;
  const expiresAt = expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000);

  return { accessToken, refreshToken, expiresAt, scope };
}

function describeOAuthError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const body = payload as Record<string, unknown>;
  const description = body.error_description ?? body.message ?? body.error;

  return typeof description === "string" ? description.slice(0, 300) : null;
}

/**
 * Which public fields the authorize step needs before it can redirect.
 *
 * Salesforce needs the login host, Databricks needs the workspace hostname —
 * the authorize URL literally cannot be built without them, so the form
 * collects them first and this is what tells it which.
 */
export function preAuthorizeFields(kind: SourceKind) {
  const spec = findAuthMethod(kind, "oauth2");
  return spec ? publicFields(spec) : [];
}
