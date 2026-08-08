"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { CredentialFields } from "@/components/sources/credential-fields";
import {
  authMethodsFor,
  credentialValuesSchema,
  defaultAuthMethod,
  findAuthMethod,
  publicFields,
  type AuthMethod,
  type CredentialStatus,
} from "@/types/credentials";
import { SOURCE_KIND_LABEL, type Source } from "@/types/source";

/**
 * The connect screen — method selector plus whatever fields that method needs.
 *
 * Two paths out of here, and they are genuinely different operations rather
 * than two styles of the same one:
 *
 *   OAuth   a link to /api/oauth/:kind/authorize. The browser leaves Canon,
 *           authenticates at the provider, and comes back with a code the
 *           server exchanges. No secret is ever typed into this form.
 *   the rest a PUT to /api/sources/:id/credentials with the values below.
 *
 * OAuth is listed first for every platform that supports it, and the summary
 * under the selector says why in one line, because "which of these should I
 * pick" is the actual question someone has on this screen.
 */
export function ConnectSourceForm({
  source,
  credential,
  oauthAvailable,
  encryptionReady,
}: {
  source: Source;
  /** Redacted — key names and dates only. A value never reaches this component. */
  credential: CredentialStatus | null;
  /** Whether this deployment has an app registration for the platform. */
  oauthAvailable: boolean;
  /** Whether CANON_CREDENTIAL_KEY is set. Nothing can be stored without it. */
  encryptionReady: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const methodId = `${formId}-method`;

  const methods = authMethodsFor(source.kind);
  const [method, setMethod] = useState<AuthMethod>(
    credential?.method ?? defaultAuthMethod(source.kind),
  );

  // Public values survive a method switch — the Databricks hostname is the same
  // hostname whether you connect with OAuth or a PAT, and clearing it on every
  // switch would punish anyone comparing the two.
  const [values, setValues] = useState<Record<string, string>>(credential?.publicValues ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const spec = useMemo(() => findAuthMethod(source.kind, method), [source.kind, method]);
  const isOAuth = method === "oauth2";

  function change(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  /**
   * The OAuth link carries the public fields as query params, because the
   * authorize URL is built from them server-side and the browser has to
   * navigate rather than fetch. They are re-validated in the route handler —
   * one of them is interpolated into a URL Canon redirects to.
   */
  const authorizeHref = useMemo(() => {
    const params = new URLSearchParams({ sourceId: source.id });
    for (const field of spec ? publicFields(spec) : []) {
      const value = (values[field.key] ?? "").trim();
      if (value) params.set(field.key, value);
    }
    return `/api/oauth/${source.kind}/authorize?${params.toString()}`;
  }, [source.id, source.kind, spec, values]);

  const oauthReady =
    !spec ||
    publicFields(spec).every((field) => field.optional || (values[field.key] ?? "").trim() !== "");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setMessage(null);

    if (!spec) return;

    // A secret that is already stored may be left blank to keep it, so those
    // keys are dropped before validation rather than sent empty — an empty
    // string would overwrite a working credential with nothing.
    const stored = new Set(credential?.method === method ? credential.secretKeys : []);
    const submitted: Record<string, string> = {};

    for (const field of spec.fields) {
      const value = (values[field.key] ?? "").trim();
      if (value === "" && field.sensitivity === "secret" && stored.has(field.key)) continue;
      if (value === "" && field.optional) continue;
      submitted[field.key] = value;
    }

    // The same schema the route handler runs, for the message rather than the
    // truth — the server validates again and is what decides.
    const checked = credentialValuesSchema(spec).safeParse(submitted);
    if (!checked.success) {
      const found: Record<string, string> = {};
      for (const issue of checked.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !found[key]) found[key] = issue.message;
      }
      setErrors(found);
      return;
    }

    setSaving(true);

    const response = await fetch(`/api/sources/${source.id}/credentials`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: source.kind, method, values: checked.data }),
    }).catch(() => null);

    const payload: unknown = await response?.json().catch(() => null);
    setSaving(false);

    if (!response?.ok) {
      const body = (payload ?? {}) as { error?: string; issues?: Record<string, string> };
      setMessage(body.error ?? "Could not store the credential.");
      if (body.issues) {
        // Server issues are keyed `values.password`; fields are keyed `password`.
        const mapped: Record<string, string> = {};
        for (const [path, text] of Object.entries(body.issues)) {
          mapped[path.replace(/^values\./, "")] = text;
        }
        setErrors(mapped);
      }
      return;
    }

    router.push("/sources");
    router.refresh();
  }

  async function disconnect() {
    setMessage(null);
    setSaving(true);

    const response = await fetch(`/api/sources/${source.id}/credentials`, {
      method: "DELETE",
    }).catch(() => null);

    setSaving(false);

    if (!response?.ok) {
      setMessage("Could not disconnect this source.");
      return;
    }

    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-[560px] flex-col gap-6">
      {!encryptionReady ? (
        <p
          role="alert"
          className="border-l-2 border-g-900 bg-surface-sunken px-3 py-2 text-body text-g-900"
        >
          Canon cannot store credentials yet — <span className="font-mono">CANON_CREDENTIAL_KEY</span>{" "}
          is not set. Generate one with{" "}
          <span className="font-mono">openssl rand -base64 32</span> and add the same value to{" "}
          <span className="font-mono">web/.env</span> and <span className="font-mono">engine/.env</span>.
        </p>
      ) : null}

      <Field
        label="Method"
        htmlFor={methodId}
        hint={spec?.summary}
        error={errors.method}
      >
        <Select
          {...fieldAria(methodId, { hint: true, error: Boolean(errors.method) })}
          value={method}
          onChange={(event) => setMethod(event.target.value as AuthMethod)}
        >
          {methods.map((option) => (
            <option key={option.method} value={option.method}>
              {option.label}
              {option.method === methods[0].method ? " — recommended" : ""}
            </option>
          ))}
        </Select>
      </Field>

      {spec ? (
        <CredentialFields
          fields={isOAuth ? publicFields(spec) : spec.fields}
          values={values}
          storedKeys={credential?.method === method ? credential.secretKeys : []}
          errors={errors}
          disabled={saving || !encryptionReady}
          onChange={change}
        />
      ) : null}

      {isOAuth ? (
        <OAuthPanel
          platform={SOURCE_KIND_LABEL[source.kind]}
          href={authorizeHref}
          ready={oauthReady && encryptionReady}
          available={oauthAvailable}
          connected={credential?.method === "oauth2" ? credential : null}
        />
      ) : (
        <p className="max-w-[460px] border-l-2 border-g-900 pl-3 text-body text-g-600">
          Secrets are encrypted with AES-256-GCM before they are written and are
          never returned by any endpoint. Only the engine decrypts them, in its
          own process, for the length of a run.
        </p>
      )}

      {message ? (
        <p role="alert" className="border border-g-900 bg-surface-sunken px-3 py-2 text-body text-g-900">
          {message}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-hairline pt-5">
        {credential ? (
          <Button type="button" variant="ghost" onClick={disconnect} disabled={saving}>
            Disconnect
          </Button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/sources" className="no-underline">
              Cancel
            </Link>
          </Button>
          {!isOAuth ? (
            <Button type="submit" disabled={saving || !encryptionReady}>
              {saving ? "Saving…" : credential ? "Replace credential" : "Save credential"}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

/**
 * The OAuth branch. A link, not a submit — the browser has to navigate away for
 * the user to authenticate at the provider, and a fetch cannot do that.
 */
function OAuthPanel({
  platform,
  href,
  ready,
  available,
  connected,
}: {
  platform: string;
  href: string;
  ready: boolean;
  available: boolean;
  connected: CredentialStatus | null;
}) {
  if (!available) {
    return (
      <p className="max-w-[460px] border-l-2 border-g-900 pl-3 text-body text-g-600">
        This deployment has no {platform} app registration, so OAuth is
        unavailable. Register Canon with {platform} and set the client id in{" "}
        <span className="font-mono">web/.env</span>, or pick another method above.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t border-hairline pt-5">
      {connected ? (
        <dl className="flex flex-col gap-1 font-mono text-value text-g-600">
          <div className="flex gap-2">
            <dt className="text-g-500">granted</dt>
            <dd className="text-g-900">{connected.scope ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-g-500">expires</dt>
            <dd className="text-g-900">
              {connected.expiresAt ? connected.expiresAt.toISOString().slice(0, 16).replace("T", " ") : "no expiry"}
            </dd>
          </div>
        </dl>
      ) : null}

      <p className="max-w-[460px] text-body text-g-600">
        You will sign in at {platform}. Canon receives a scoped, revocable grant
        — never your password — and stores it encrypted.
      </p>

      {/* Disabled state is a span, not a disabled anchor: an <a> with
          aria-disabled is still focusable and still navigable by keyboard. */}
      {ready ? (
        <Button asChild>
          <a href={href} className="no-underline">
            {connected ? `Reconnect ${platform}` : `Connect ${platform}`}
          </a>
        </Button>
      ) : (
        <p className="text-body text-g-500">
          Fill in the fields above to continue to {platform}.
        </p>
      )}
    </div>
  );
}
