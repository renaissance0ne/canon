import { isUuid, notFound, parseJson } from "@/app/api/_lib/respond";
import { requireReviewerForApi } from "@/lib/server/auth";
import { CredentialKeyError } from "@/lib/server/crypto";
import { deleteCredentials, readStatus, storeCredentials } from "@/lib/server/credentials";
import { getSource } from "@/lib/server/sources";
import { findAuthMethod, storeCredentialsSchema } from "@/types/credentials";

/**
 * /api/sources/:sourceId/credentials — the non-OAuth half of connecting.
 *
 *   GET     redacted status: which method, which keys exist, when it expires
 *   PUT     store or replace a token / password / key-pair credential
 *   DELETE  disconnect
 *
 * There is no endpoint here that returns a secret, and adding one would defeat
 * the feature: the console's job is to show that a credential exists and let
 * someone replace it, not to display it back. The engine is the only process
 * that ever holds a plaintext credential, in its own memory, for the length of
 * a run.
 *
 * PUT rather than POST because there is at most one credential per source — the
 * unique index says so — and reconnecting replaces rather than accumulates.
 * Two live grants for one source would make "which did the run use?"
 * unanswerable.
 *
 * OAuth is deliberately NOT accepted here. Its credential is minted by
 * /api/oauth/:kind/callback from a code the provider issued; a browser posting
 * an OAuth token to this route would mean Canon had handled a credential the
 * user typed into Canon, which is the exact thing OAuth exists to avoid.
 * `storeCredentialsSchema` rejects it.
 */

export async function GET(_request: Request, ctx: RouteContext<"/api/sources/[sourceId]/credentials">) {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const { sourceId } = await ctx.params;
  if (!isUuid(sourceId)) return notFound("No such source.");

  const status = await readStatus(sourceId);
  return Response.json({ credential: status });
}

export async function PUT(request: Request, ctx: RouteContext<"/api/sources/[sourceId]/credentials">) {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const { sourceId } = await ctx.params;
  if (!isUuid(sourceId)) return notFound("No such source.");

  const parsed = await parseJson(request, storeCredentialsSchema);
  if (!parsed.ok) return parsed.response;

  // The source is loaded rather than trusted from the body. `kind` decides
  // which fields are secret, so a client that could name its own kind could
  // name one whose schema marks the password field `public` — and Canon would
  // store it in clear, in a column the console displays.
  const source = await getSource(sourceId);
  if (!source) return notFound("No such source.");

  if (source.kind !== parsed.data.kind) {
    return Response.json(
      { error: `This source is ${source.kind}, not ${parsed.data.kind}.` },
      { status: 400 },
    );
  }

  const spec = findAuthMethod(source.kind, parsed.data.method);
  if (!spec) return notFound("No such auth method for this source.");

  // Split by the schema, not by the caller. A field marked `secret` in
  // types/credentials.ts is encrypted no matter what the request implies.
  const secrets: Record<string, string> = {};
  const publicValues: Record<string, string> = {};

  for (const field of spec.fields) {
    const value = parsed.data.values[field.key];
    if (value === undefined || value === "") continue;
    if (field.sensitivity === "secret") secrets[field.key] = value;
    else publicValues[field.key] = value;
  }

  try {
    const result = await storeCredentials({
      sourceId,
      kind: source.kind,
      method: parsed.data.method,
      publicValues,
      secrets,
      // From the session. A body-supplied owner would make "whose access did
      // this run use?" a claim rather than a fact.
      connectedBy: gate.reviewer.userId,
    });

    if (!result.ok) {
      return Response.json({ error: result.message }, { status: result.code });
    }

    return Response.json({ credential: result.status });
  } catch (error) {
    // A missing root key is a deployment problem and its message names the env
    // var to set. Anything else is not described to the client at all — a
    // failure while handling a plaintext credential is the last place to be
    // generous with detail.
    if (error instanceof CredentialKeyError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error("[canon] storing credentials failed", error);
    return Response.json({ error: "Could not store the credential." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/sources/[sourceId]/credentials">,
) {
  const gate = await requireReviewerForApi();
  if (!gate.ok) return gate.response;

  const { sourceId } = await ctx.params;
  if (!isUuid(sourceId)) return notFound("No such source.");

  const removed = await deleteCredentials(sourceId);
  if (!removed) return notFound("This source has no stored credential.");

  return Response.json({ sourceId, disconnected: true });
}
