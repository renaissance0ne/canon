import { cookies } from "next/headers";
import { requireReviewer } from "@/lib/server/auth";
import { CredentialKeyError } from "@/lib/server/crypto";
import { storeCredentials } from "@/lib/server/credentials";
import {
  exchangeCode,
  OAuthConfigError,
  OAuthExchangeError,
  STATE_COOKIE,
  verifyState,
} from "@/lib/server/oauth";
import { sourceKindSchema } from "@/types/source";

/**
 * GET /api/oauth/:kind/callback — step two, where the grant is minted.
 *
 * This is the only place in Canon that turns an authorization code into a
 * stored credential. The order of operations below is the security of the
 * whole flow, and each step is load-bearing:
 *
 *   1. session          this must be the user who started the flow, not
 *                       whoever was handed the callback URL
 *   2. state            constant-time against the sealed cookie — without it,
 *                       an attacker's code can be planted on a user's source
 *   3. exchange         server to server, over the client secret / PKCE
 *                       verifier; the code never returns to the browser
 *   4. encrypt + store  the refresh token is sealed before it is written, so
 *                       it is never at rest in clear
 *   5. clear the cookie single-use, whatever the outcome
 *
 * The user is redirected back to the console either way. An OAuth failure is
 * an ordinary thing — a declined consent screen, a timed-out tab — and it
 * deserves a sentence on the page they started from, not a stack trace.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/oauth/[kind]/callback">) {
  const reviewer = await requireReviewer();

  const jar = await cookies();
  const cookieValue = jar.get(STATE_COOKIE)?.value;
  // Single-use, whatever happens next. A state cookie that survives its own
  // callback is a replayable one.
  jar.delete({ name: STATE_COOKIE, path: "/api/oauth" });

  const { kind: rawKind } = await ctx.params;
  const kind = sourceKindSchema.safeParse(rawKind);
  if (!kind.success) return back("/sources", "Unknown platform.");

  const url = new URL(request.url);

  // The provider declined before anything else can matter — a user who pressed
  // Cancel is not an error to investigate.
  const providerError = url.searchParams.get("error");
  if (providerError) {
    const description = url.searchParams.get("error_description");
    return back("/sources", describeDecline(providerError, description));
  }

  const pending = verifyState(cookieValue, url.searchParams.get("state"), kind.data);
  if (!pending) {
    return back(
      "/sources",
      "That connection attempt could not be verified — it may have expired. Start again.",
    );
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return back(`/sources/${pending.sourceId}/connect`, "The provider returned no authorization code.");
  }

  try {
    const grant = await exchangeCode(pending, code, request.url);

    // A grant with no refresh token expires and cannot renew itself, which for
    // a scheduled reconciliation means silently failing at 3am. Worth saying
    // out loud at connect time rather than discovering it in a failed run.
    const noRefresh = grant.refreshToken === null;

    const result = await storeCredentials({
      sourceId: pending.sourceId,
      kind: kind.data,
      method: "oauth2",
      publicValues: pending.publicValues,
      secrets: {
        accessToken: grant.accessToken,
        ...(grant.refreshToken ? { refreshToken: grant.refreshToken } : {}),
      },
      // From the session, never from the callback. This is the answer to
      // "whose access did this run use?".
      connectedBy: reviewer.userId,
      expiresAt: grant.expiresAt,
      scope: grant.scope,
    });

    if (!result.ok) {
      return back(`/sources/${pending.sourceId}/connect`, result.message);
    }

    return back(
      "/sources",
      null,
      noRefresh
        ? "Connected — but the provider issued no refresh token, so this will need reconnecting when it expires."
        : "Connected.",
    );
  } catch (error) {
    if (error instanceof CredentialKeyError || error instanceof OAuthConfigError) {
      return back(`/sources/${pending.sourceId}/connect`, error.message);
    }
    if (error instanceof OAuthExchangeError) {
      return back(`/sources/${pending.sourceId}/connect`, error.message);
    }

    // Nothing derived from a token reaches the client. The server log gets the
    // detail; the browser gets a sentence.
    console.error("[canon] OAuth callback failed", error);
    return back(`/sources/${pending.sourceId}/connect`, "Could not complete the connection.");
  }
}

/** RFC 6749 §4.1.2.1 — `access_denied` is a person clicking Cancel, not a fault. */
function describeDecline(error: string, description: string | null): string {
  if (error === "access_denied") return "Connection cancelled at the provider.";
  return description ? `${error}: ${description.slice(0, 200)}` : `The provider returned ${error}.`;
}

/**
 * Back into the console, carrying one message.
 *
 * `path` is always a literal from this file — never anything user-supplied —
 * so this cannot become an open redirect.
 */
function back(path: string, error: string | null, notice?: string): Response {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  if (notice) params.set("notice", notice);

  const query = params.toString();
  return new Response(null, {
    status: 307,
    headers: { Location: query ? `${path}?${query}` : path },
  });
}
