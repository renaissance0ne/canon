"use client";

import { useId } from "react";
import { Field, fieldAria } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CredentialFieldSpec } from "@/types/credentials";

/**
 * One input per field in the schema. Nothing here knows what Salesforce is.
 *
 * This is the whole point of `@/types/credentials`: adding a platform, or a
 * field to one, changes a data structure and this component renders it. There
 * is no per-platform form, no `if (kind === "snowflake")`, and no second place
 * where "Databricks needs an HTTP path" is written down.
 *
 * SECRET FIELDS ARE WRITE-ONLY. A stored secret is never sent to the browser,
 * so a field that already has a value renders empty with a "stored" note rather
 * than pre-filled. Leaving it empty on save keeps what is stored; typing in it
 * replaces. That is the only interaction model that does not require the server
 * to hand a token back to a form in order to redisplay it.
 */
export function CredentialFields({
  fields,
  values,
  storedKeys,
  errors,
  disabled,
  onChange,
}: {
  fields: CredentialFieldSpec[];
  values: Record<string, string>;
  /** Secret keys already stored for this source. Renders the "stored" state. */
  storedKeys?: string[];
  errors?: Record<string, string>;
  disabled?: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const formId = useId();
  const stored = new Set(storedKeys ?? []);

  if (fields.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      {fields.map((field) => {
        const fieldId = `${formId}-${field.key}`;
        const isStored = field.sensitivity === "secret" && stored.has(field.key);
        const hint = hintFor(field, isStored);

        return (
          <Field
            key={field.key}
            label={labelFor(field)}
            htmlFor={fieldId}
            hint={hint}
            error={errors?.[field.key]}
          >
            {field.input === "textarea" ? (
              <Textarea
                {...fieldAria(fieldId, { hint: Boolean(hint), error: Boolean(errors?.[field.key]) })}
                value={values[field.key] ?? ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                placeholder={isStored ? "" : field.placeholder}
                rows={6}
                disabled={disabled}
                // A PEM block is a credential. Nothing about it should be
                // corrected, completed, capitalized or offered back later.
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                required={!field.optional && !isStored}
              />
            ) : (
              <Input
                {...fieldAria(fieldId, { hint: Boolean(hint), error: Boolean(errors?.[field.key]) })}
                type={field.input === "password" ? "password" : "text"}
                value={values[field.key] ?? ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                placeholder={isStored ? "" : field.placeholder}
                maxLength={field.maxLength}
                disabled={disabled}
                // `new-password` rather than `off`: browsers ignore `off` on
                // password inputs, and a manager silently filling the user's
                // own login into a Salesforce service-account field is a real
                // way for the wrong credential to get stored.
                autoComplete={field.sensitivity === "secret" ? "new-password" : "off"}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                required={!field.optional && !isStored}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}

/**
 * The label carries the field's own status, because there is no color to carry
 * it. `· secret` and `· stored` are the two states worth distinguishing, and
 * both are words — the same rule SeverityMark follows.
 */
function labelFor(field: CredentialFieldSpec): string {
  const parts = [field.label];
  if (field.sensitivity === "secret") parts.push("secret");
  if (field.optional) parts.push("optional");
  return parts.join(" · ");
}

function hintFor(field: CredentialFieldSpec, isStored: boolean): string | undefined {
  if (isStored) {
    return field.hint
      ? `Stored — leave blank to keep it. ${field.hint}`
      : "Stored — leave blank to keep it, or type a new value to replace it.";
  }
  return field.hint;
}
