"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api-client";
import {
  DEFAULT_INJECTION_RATES,
  INJECTION_META,
  generateDatasetSchema,
  injectionRatesSchema,
  type DatasetSummary,
  type InjectionRates,
} from "@/types/dataset";

const RATE_KEYS = Object.keys(DEFAULT_INJECTION_RATES) as (keyof InjectionRates)[];

/**
 * The console's front end for `eval/generate.py`.
 *
 * Every parameter here is a parameter of the generator itself — seed, account
 * count, and the six injection rates — so a dataset built from this form is the
 * same bytes as one built from the CLI with the same values. Nothing is added
 * that the generator does not have, because a knob the console invented would
 * be a knob no reported result could cite.
 *
 * Rates are typed as percentages and sent as fractions. Percentages are what
 * AGENTS.md's injection table is written in and what a reviewer reasons in; the
 * fraction is what the generator consumes.
 */
export function GenerateDatasetForm({ existing }: { existing: string[] }) {
  const router = useRouter();
  const formId = useId();

  const [name, setName] = useState("");
  const [seed, setSeed] = useState("42");
  const [accounts, setAccounts] = useState("500");
  const [percent, setPercent] = useState<Record<string, string>>(() =>
    Object.fromEntries(RATE_KEYS.map((key) => [key, String(DEFAULT_INJECTION_RATES[key] * 100)])),
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  /** A name that is taken. The only way past it is an explicit overwrite. */
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DatasetSummary | null>(null);

  const nameId = `${formId}-name`;
  const seedId = `${formId}-seed`;
  const accountsId = `${formId}-accounts`;

  const total = RATE_KEYS.reduce((sum, key) => sum + (Number(percent[key]) || 0), 0);

  async function submit(force: boolean) {
    setErrors({});
    setMessage(null);
    setConflict(false);

    const rates = Object.fromEntries(
      RATE_KEYS.map((key) => [key, round((Number(percent[key]) || 0) / 100)]),
    );

    // The same schemas the route handler runs, so a bad rate is an inline
    // message rather than a round trip. The server still runs them: this is
    // for the message, never for the truth.
    const checkedRates = injectionRatesSchema.safeParse(rates);
    if (!checkedRates.success) {
      setErrors({ rates: checkedRates.error.issues[0]?.message ?? "Invalid rates." });
      return;
    }

    const body = generateDatasetSchema.safeParse({
      name: name.trim(),
      seed: Number(seed),
      accounts: Number(accounts),
      rates: checkedRates.data,
      force,
    });

    if (!body.success) {
      setErrors(mapIssues(body.error.issues));
      return;
    }

    setBusy(true);
    setResult(null);
    const response = await postJson<{ dataset: DatasetSummary }>("/api/datasets", body.data);
    setBusy(false);

    if (!response.ok) {
      setMessage(response.message);
      // The engine says a directory already holds a dataset. Overwriting is
      // offered, never assumed — numbers already reported against that name
      // stop being reproducible the moment it is replaced.
      setConflict(/already holds a dataset/i.test(response.message));
      return;
    }

    setResult(response.data.dataset);
    // The table above this form is server-rendered from the engine's disk.
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
      noValidate
      className="flex max-w-[640px] flex-col gap-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor={nameId} hint="A directory on the engine." error={errors.name}>
          <Input
            {...fieldAria(nameId, { hint: true, error: Boolean(errors.name) })}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={`run${seed || "42"}`}
            maxLength={64}
            required
            autoFocus
          />
        </Field>

        <Field label="Seed" htmlFor={seedId} hint="Same seed, same bytes." error={errors.seed}>
          <Input
            {...fieldAria(seedId, { hint: true, error: Boolean(errors.seed) })}
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            inputMode="numeric"
            required
          />
        </Field>

        <Field
          label="Accounts"
          htmlFor={accountsId}
          hint="Users, roles and territories scale with it."
          error={errors.accounts}
        >
          <Input
            {...fieldAria(accountsId, { hint: true, error: Boolean(errors.accounts) })}
            value={accounts}
            onChange={(event) => setAccounts(event.target.value)}
            inputMode="numeric"
            required
          />
        </Field>
      </div>

      <fieldset className="border-t border-hairline pt-5">
        <legend className="sr-only">Injection rates</legend>

        <div className="flex items-baseline justify-between gap-4">
          <p className="text-label uppercase text-g-500">Injected divergences</p>
          <p className="font-mono text-value text-g-500">{round(total)}% of all records</p>
        </div>

        <p className="mt-2 max-w-[520px] text-body text-g-600">
          Every rate here has a detector on the other side. Keep{" "}
          <span className="font-mono text-value text-g-900">ambiguous</span> above zero — it is the
          only row that scores whether the system escalates what it should rather than guessing.
        </p>

        <div className="mt-4 border-y border-hairline">
          {RATE_KEYS.map((key) => {
            const fieldId = `${formId}-${key}`;
            return (
              <div
                key={key}
                className="flex items-center gap-4 border-b border-hairline py-2 last:border-b-0"
              >
                <label htmlFor={fieldId} className="flex-1 text-body text-g-900">
                  {INJECTION_META[key].label}
                  <span className="ml-2 font-mono text-value text-g-500">
                    tests {INJECTION_META[key].tests}
                  </span>
                </label>
                <div className="flex w-[92px] shrink-0 items-center gap-1.5">
                  <Input
                    id={fieldId}
                    className="text-right"
                    value={percent[key] ?? ""}
                    onChange={(event) =>
                      setPercent((current) => ({ ...current, [key]: event.target.value }))
                    }
                    inputMode="decimal"
                    aria-label={`${INJECTION_META[key].label} rate, percent`}
                  />
                  <span className="font-mono text-value text-g-500">%</span>
                </div>
              </div>
            );
          })}
        </div>

        <p aria-live="polite" className="mt-2 text-body text-g-900 empty:hidden">
          {errors.rates ? (
            <span className="border-l-2 border-g-900 pl-2">{errors.rates}</span>
          ) : null}
        </p>
      </fieldset>

      {existing.length > 0 ? (
        <p className="font-mono text-value text-g-500">on disk · {existing.join(" · ")}</p>
      ) : null}

      {message ? (
        <div
          role="alert"
          className="flex flex-col gap-3 border border-g-900 bg-surface-sunken px-3 py-2.5"
        >
          <p className="text-body text-g-900">{message}</p>
          {conflict ? (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => void submit(true)}>
                Overwrite {name.trim()}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {result ? <GeneratedSummary dataset={result} /> : null}

      <div className="flex items-center justify-end gap-3 border-t border-hairline pt-5">
        <p className="mr-auto font-mono text-value text-g-500">POST /api/datasets</p>
        <Button type="submit" disabled={busy}>
          {busy ? "Generating…" : "Generate dataset"}
        </Button>
      </div>
    </form>
  );
}

/**
 * What the seed actually produced. Shown rather than a success toast, because
 * the numbers are the point: the manifest is the ground truth every reported
 * metric is measured against, and the operator should see its shape before
 * running anything against it.
 */
function GeneratedSummary({ dataset }: { dataset: DatasetSummary }) {
  const entries = Object.entries(dataset.byClass).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="border-l-2 border-g-900 pl-3">
      <p className="text-body text-g-900">
        Generated <span className="font-mono text-value font-medium text-g-900">{dataset.name}</span>{" "}
        — {dataset.entitiesA.toLocaleString()} records on side A,{" "}
        {dataset.entitiesB.toLocaleString()} on side B.
      </p>
      <p className="mt-1 font-mono text-value text-g-600">
        {dataset.divergences} divergences · {dataset.escalations} expected to escalate
      </p>
      <p className="mt-1 font-mono text-value text-g-500">
        {entries.map(([className, count]) => `${className} ${count}`).join(" · ")}
      </p>
    </div>
  );
}

/** Two decimals of a fraction — 12% is 0.12, not 0.12000000000000001. */
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

type Issue = { path: PropertyKey[]; message: string };

/** Server issues are keyed by path (`rates.ambiguous`); fields by root. */
function mapIssues(issues: readonly Issue[]): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const issue of issues) {
    mapped[String(issue.path[0] ?? "_")] = issue.message;
  }
  return mapped;
}
