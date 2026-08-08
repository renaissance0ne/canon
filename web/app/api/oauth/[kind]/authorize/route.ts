import { cookies } from "next/headers";
import { requireReviewer } from "@/lib/server/auth";
import { getSource } from "@/lib/server/sources";
import {
  OAuthConfigError,
  STATE_COOKIE,
  STATE_TTL_SECONDS,
  startAuthorization,
} from "@/lib/server/oauth";
import { isUuid } from "@/app/api/_lib/respond";
import { findAuthMethod } from "@/types/credentials";
import { sourceKindSchema } from "@/types/source";

/**
 * GET /api/oauth/:kind/authorize?sourceId=… — step one of connecting.
 *
 * Ends in a 307 to the provider, so it is reached by a link rather than a
 * fetch: the browser has to navigate for the user to be able to sign in at
 * Salesforce or Databricks. That makes `requireReviewer()` the right gate here
 * rather than `requireReviewerForApi()` — a signed-out user should land on
 * sign-in, not read a JSON 401 in their address bar.
 *
 * Errors redirect back to the source's connect screen with a message rather
 * than rendering a bare error page. Someone three clicks into connecting a
 * warehouse should end up where they started, told what went wrong.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/oauth/[kind]/authorize">) {
  await requireReviewer();

  const { kind: rawKind } = await ctx.params;
  const kind = sourceKindSchema.safeParse(rawKind);
  if (!kind.success) {
    return fail("/sources", "Unknown platform.");
  }

  const url = new URL(request.url);
  const sourceId = url.searchParams.get("sourceId") ?? "";

  if (!isUuid(sourceId)) {
    return fail("/sources", "That connect link is missing its source.");
  }

  const source = await getSource(sourceId);
  if (!source) return fail("/sources", "No such source.");

  if (source.kind !== kind.data) {
    return fail(`/sources/${sourceId}/connect`, `This source is ${source.kind}.`);
  }

  const spec = findAuthMethod(source.kind, "oauth2");
  if (!spec) {
    return fail(`/sources/${sourceId}/connect`, `${source.kind} does not support OAuth.`);
  }

  // The public fields the authorize URL is built from — login host, workspace
  // hostname, Snowflake account. They arrive as query params from the connect
  // form, and are validated against the schema rather than passed through:
  // these are interpolated into a URL Canon then sends a browser to.
  const publicValues: Record<string, string> = {};

  for (const field of spec.fields) {
    const value = (url.searchParams.get(field.key) ?? "").trim();

    if (!value) {
      if (field.optional) continue;
      return fail(`/sources/${sourceId}/connect`, `${field.label} is required to connect.`);
    }

    if (value.length > (field.maxLength ?? 1024)) {
      return fail(`/sources/${sourceId}/connect`, `${field.label} is too long.`);
    }

    // A hostname is the one class of value here that becomes part of a URL
    // Canon issues a redirect to. Anything carrying a scheme, a path, a
    // credential or a port is not a hostname, and letting one through turns
    // `https://{loginHost}/services/…` into an open redirect.
    if (isHostField(field.key) && !isPlainHost(value)) {
      return fail(
        `/sources/${sourceId}/connect`,
        `${field.label} must be a bare hostname — no https://, no path.`,
      );
    }

    publicValues[field.key] = value;
  }

  let started;
  try {
    started = startAuthorization({
      kind: source.kind,
      sourceId,
      publicValues,
      requestUrl: request.url,
    });
  } catch (error) {
    if (error instanceof OAuthConfigError) {
      return fail(`/sources/${sourceId}/connect`, error.message);
    }
    throw error;
  }

  const jar = await cookies();
  jar.set(STATE_COOKIE, started.state, {
    httpOnly: true,
    // Lax, not Strict: the callback is a cross-site navigation back from the
    // provider, and Strict would withhold the cookie precisely then.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/oauth",
    maxAge: STATE_TTL_SECONDS,
  });

  return Response.redirect(started.authorizeUrl, 307);
}

/**
 * DNS labels separated by dots, and nothing else.
 *
 * One label is allowed on purpose: Snowflake's `account` is interpolated as a
 * subdomain (`{account}.snowflakecomputing.com`) and is normally a single
 * `ORGNAME-ACCOUNTNAME` label, though legacy account locators are dotted.
 * Label count is not the security property here — what matters is that a
 * scheme, a path, a port, an `@` or a `?` cannot get through, because each of
 * those turns `https://{host}/services/…` into a URL pointing somewhere else.
 */
function isPlainHost(value: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(value);
}

/** The public fields that get interpolated into a URL Canon redirects a browser to. */
function isHostField(key: string): boolean {
  return key === "loginHost" || key === "serverHostname" || key === "account";
}

/**
 * Back to where the user was, carrying the reason.
 *
 * Relative Location only — every target here is a path this app owns, and
 * building one from anything user-supplied is how a redirect becomes an open
 * redirect.
 */
function fail(path: string, message: string): Response {
  const target = `${path}?error=${encodeURIComponent(message)}`;
  return new Response(null, { status: 307, headers: { Location: target } });
}
