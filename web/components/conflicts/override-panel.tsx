"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { checkObservedValue, observedValues } from "@/lib/validate-value";
import { RESOLUTION_STATUS_GLYPH } from "@/types/resolution";
import type { QueueRow } from "@/types/queue";

/**
 * Wireframe 1l — override, open.
 *
 * The constraint is the point of this panel: an override "must be one of the two
 * observed values, or a legal normalization of one. The engine's validate node
 * applies the same check to the model."
 *
 * So the observed values are listed right under the box, clickable, and the same
 * check runs as you type. It runs again in the route handler, which is where the
 * truth is — this copy exists so the message arrives before the round trip, the
 * same arrangement as the source form.
 *
 * A hand-typed parent id that neither system holds breaks rollups exactly as
 * badly as a hallucinated one, and the audit trail would record a human as the
 * author of it. Hence no escape hatch.
 */
export function OverridePanel({
  row,
  onSubmit,
  onCancel,
  pending,
}: {
  row: QueueRow;
  onSubmit: (overrideValue: string, note: string) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const formId = useId();
  const valueId = `${formId}-value`;
  const noteId = `${formId}-note`;

  const observed = observedValues(row);
  const [value, setValue] = useState(observed[0] ?? "");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  const check = checkObservedValue(value, observed);
  const error = touched && !check.ok ? check.reason : undefined;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!check.ok) return;
    // Submitted as the observed value it folds onto, not as typed: a resolved
    // hierarchy full of hand-typed capitalisation variants is a new conflict.
    onSubmit(check.matches, note.trim());
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 pt-1">
      <Field
        label="Override value"
        htmlFor={valueId}
        error={error}
        hint="Must be one of the observed values, or a legal normalization of one."
      >
        <Input
          {...fieldAria(valueId, { hint: true, error: Boolean(error) })}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => setTouched(true)}
          autoFocus
        />
      </Field>

      {/* The two things it is legal to choose, one click each. A reviewer working
          a queue of 400 should not be retyping account ids. */}
      <ul className="flex flex-col gap-1">
        {observed.map((candidate, index) => {
          const side = row.a.values.includes(candidate) ? row.a : row.b;
          const chosen = check.ok && check.matches === candidate;

          return (
            <li key={`${candidate}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  setValue(candidate);
                  setTouched(true);
                }}
                className="flex items-baseline gap-2 font-mono text-value text-g-600 hover:text-g-900"
              >
                <span aria-hidden>
                  {chosen
                    ? RESOLUTION_STATUS_GLYPH.auto_applied
                    : RESOLUTION_STATUS_GLYPH.proposed}
                </span>
                <span className={chosen ? "font-medium text-g-900" : undefined}>
                  {candidate}
                </span>
                <span className="text-g-500">· {side.sourceName}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <Field
        label="Note · goes into the audit detail"
        htmlFor={noteId}
        hint="Why the warehouse was right. The next person reading this row sees it."
      >
        <Textarea
          {...fieldAria(noteId, { hint: true })}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !check.ok}>
          {pending ? "Saving…" : "Save override"}
        </Button>
      </div>
    </form>
  );
}
