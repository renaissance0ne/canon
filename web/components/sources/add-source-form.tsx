"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/api-client";
import {
  SOURCE_KIND_LABEL,
  SOURCE_KIND_SIDE,
  sourceConfigSchema,
  sourceKindSchema,
  type Source,
  type SourceKind,
} from "@/types/source";

const KINDS = sourceKindSchema.options;

/**
 * A starting shape per kind, so the config field is never a blank box. These
 * are examples, not policy — every one of them is meant to be edited.
 *
 * Note what is absent: there is no host, no user, no token, no key. Connection
 * secrets are keyed by `kind` in the engine's environment and never travel
 * through this form or land in this column.
 */
const CONFIG_TEMPLATE: Record<SourceKind, string> = {
  salesforce: `{
  "objects": ["Account", "User", "UserRole", "Territory"],
  "filter": "IsDeleted = false"
}`,
  hubspot: `{
  "objects": ["companies", "owners", "teams"]
}`,
  databricks: `{
  "objects": ["gtm.dim_account", "gtm.dim_user", "gtm.dim_territory"]
}`,
  snowflake: `{
  "objects": ["GTM.DIM_ACCOUNT", "GTM.DIM_USER", "GTM.DIM_TERRITORY"]
}`,
  synthetic: `{
  "objects": ["accounts", "users", "roles", "territories"]
}`,
};

const NAME_TEMPLATE: Record<SourceKind, string> = {
  salesforce: "Salesforce (prod)",
  hubspot: "HubSpot (prod)",
  databricks: "Databricks GTM",
  snowflake: "Snowflake GTM",
  synthetic: "Synthetic · seed 42",
};

/** Wireframe 1c. Zod-validated here for the message, and again server-side for the truth. */
export function AddSourceForm({ defaultKind }: { defaultKind: SourceKind }) {
  const router = useRouter();
  const formId = useId();

  const [kind, setKind] = useState<SourceKind>(defaultKind);
  const [name, setName] = useState(NAME_TEMPLATE[defaultKind]);
  const [config, setConfig] = useState(CONFIG_TEMPLATE[defaultKind]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameId = `${formId}-name`;
  const kindId = `${formId}-kind`;
  const configId = `${formId}-config`;

  /**
   * Changing kind rewrites the two fields that are only ever kind-shaped —
   * but not once they have been edited away from the template, because
   * discarding someone's typing to be helpful is not helpful.
   */
  function changeKind(next: SourceKind) {
    if (name === NAME_TEMPLATE[kind]) setName(NAME_TEMPLATE[next]);
    if (config === CONFIG_TEMPLATE[kind]) setConfig(CONFIG_TEMPLATE[next]);
    setKind(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setMessage(null);

    let parsedConfig: unknown;
    try {
      parsedConfig = JSON.parse(config);
    } catch {
      setErrors({ config: "Not valid JSON." });
      return;
    }

    // The same schema the route handler runs. Doing it here too is not
    // duplicated truth — it is the difference between an inline message and a
    // round trip.
    const checked = sourceConfigSchema.safeParse(parsedConfig);
    if (!checked.success) {
      setErrors({ config: checked.error.issues[0]?.message ?? "Invalid config shape." });
      return;
    }

    setSaving(true);
    const result = await postJson<{ source: Source }>("/api/sources", {
      name: name.trim(),
      kind,
      config: checked.data,
    });

    if (!result.ok) {
      setSaving(false);
      setMessage(result.message);
      if (result.issues) setErrors(mapIssues(result.issues));
      return;
    }

    router.push("/sources");
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-[520px] flex-col gap-6">
      <Field label="Name" htmlFor={nameId} error={errors.name}>
        <Input
          {...fieldAria(nameId, { error: Boolean(errors.name) })}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
          autoFocus
        />
      </Field>

      <Field
        label="Kind"
        htmlFor={kindId}
        hint={`${KINDS.join(" · ")} — ${sideHint(kind)}`}
        error={errors.kind}
      >
        <Select
          {...fieldAria(kindId, { hint: true, error: Boolean(errors.kind) })}
          value={kind}
          onChange={(event) => changeKind(event.target.value as SourceKind)}
        >
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {SOURCE_KIND_LABEL[option]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Config · non-secret shape only"
        htmlFor={configId}
        hint="Object or table names, and an optional filter. Nothing else is read."
        error={errors.config}
      >
        <Textarea
          {...fieldAria(configId, { hint: true, error: Boolean(errors.config) })}
          value={config}
          onChange={(event) => setConfig(event.target.value)}
          rows={7}
        />
      </Field>

      <p className="max-w-[440px] border-l-2 border-g-900 pl-3 text-body text-g-600">
        Credentials live in the engine environment, keyed by kind. Nothing secret
        is stored on this record.
      </p>

      {message ? (
        <p role="alert" className="border border-g-900 bg-surface-sunken px-3 py-2 text-body text-g-900">
          {message}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-hairline pt-5">
        <Button asChild variant="ghost">
          <Link href="/sources" className="no-underline">
            Cancel
          </Link>
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save source"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Which half of a run this kind can serve. Synthetic reads as either, which is
 * the point of it — one generated dataset stands in for both sides while the
 * pipeline is being built.
 */
function sideHint(kind: SourceKind): string {
  const side = SOURCE_KIND_SIDE[kind];
  if (side === "either") return "this one can serve either side of a run";
  return `this one serves the ${side === "crm" ? "CRM" : "warehouse"} side`;
}

/** Server issues are keyed by path (`config.objects`); fields are keyed by root. */
function mapIssues(issues: Record<string, string>): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [path, message] of Object.entries(issues)) {
    mapped[path.split(".")[0]] = message;
  }
  return mapped;
}
