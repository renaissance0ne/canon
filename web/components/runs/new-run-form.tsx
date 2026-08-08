"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { postJson } from "@/lib/api-client";
import { AUTO_APPLY_GATE } from "@/types/run";
import { SOURCE_KIND_LABEL, SOURCE_KIND_SIDE, type Source } from "@/types/source";
import type { Ruleset } from "@/types/rules";

type Props = { sources: Source[]; rulesets: Ruleset[] };

/**
 * Wireframe 1e — the only configuration decision a run takes.
 *
 * The spine already shows here: source A on the left, source B on the right,
 * one hairline between them. It is the same anchor as every diff downstream, so
 * by the time a reviewer reaches the conflict queue they have already learned
 * which side is which.
 */
export function NewRunForm({ sources, rulesets }: Props) {
  const router = useRouter();
  const formId = useId();

  const crmCandidates = useMemo(
    () => sources.filter((s) => SOURCE_KIND_SIDE[s.kind] !== "warehouse"),
    [sources],
  );
  const warehouseCandidates = useMemo(
    () => sources.filter((s) => SOURCE_KIND_SIDE[s.kind] !== "crm"),
    [sources],
  );

  const [sourceAId, setSourceAId] = useState(crmCandidates[0]?.id ?? "");
  const [sourceBId, setSourceBId] = useState(
    warehouseCandidates.find((s) => s.id !== crmCandidates[0]?.id)?.id ?? "",
  );
  const [rulesetId, setRulesetId] = useState(
    (rulesets.find((r) => r.isActive) ?? rulesets[0])?.id ?? "",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const aId = `${formId}-a`;
  const bId = `${formId}-b`;
  const rulesetFieldId = `${formId}-ruleset`;

  const sameSource = Boolean(sourceAId) && sourceAId === sourceBId;
  const ready = Boolean(sourceAId && sourceBId && rulesetId) && !sameSource;

  async function start() {
    setMessage(null);
    setStarting(true);

    const result = await postJson<{ runId: string }>("/api/runs", {
      sourceAId,
      sourceBId,
      rulesetId,
    });

    if (!result.ok) {
      setStarting(false);
      setMessage(result.message);
      return;
    }

    // The run row exists from here on, whatever the engine did with it. A
    // dispatch that never landed is recorded on the row and shows up as the
    // failed state on this page — not as a toast that a reload would erase.
    router.push(`/runs/${result.data.runId}`);
    router.refresh();
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      {/* The spine. Fixed 50/50, one hairline, and it never moves. */}
      <div className="grid grid-cols-1 gap-px bg-hairline-strong md:grid-cols-2">
        <div className="bg-surface p-4">
          <Field label="Source A · CRM" htmlFor={aId}>
            <Select
              {...fieldAria(aId, {})}
              value={sourceAId}
              onChange={(event) => setSourceAId(event.target.value)}
            >
              <option value="">Select a system…</option>
              {crmCandidates.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name} · {SOURCE_KIND_LABEL[source.kind]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="bg-surface p-4">
          <Field label="Source B · warehouse" htmlFor={bId}>
            <Select
              {...fieldAria(bId, {})}
              value={sourceBId}
              onChange={(event) => setSourceBId(event.target.value)}
            >
              <option value="">Select a system…</option>
              {warehouseCandidates.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name} · {SOURCE_KIND_LABEL[source.kind]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {sameSource ? (
        <p className="border-l-2 border-g-900 pl-3 text-body text-g-900">
          A and B are the same system. Reconciling a source against itself finds
          nothing — every entity matches itself and nothing ever disagrees.
        </p>
      ) : null}

      <Field
        label="Ruleset"
        htmlFor={rulesetFieldId}
        hint="The version this run executes under. Recorded on the run, so it stays reproducible."
      >
        <Select
          {...fieldAria(rulesetFieldId, { hint: true })}
          value={rulesetId}
          onChange={(event) => setRulesetId(event.target.value)}
        >
          <option value="">Select a policy…</option>
          {rulesets.map((ruleset) => (
            <option key={ruleset.id} value={ruleset.id}>
              {ruleset.name} · v{ruleset.version}
              {ruleset.isActive ? " · active" : ""}
            </option>
          ))}
        </Select>
      </Field>

      {/* Read-only, and it says so. The gate lives in engine/agent/graph.py as
          named constants because the evaluation sweeps them; a console that
          could edit them would make two runs at "the same" threshold mean
          different things. */}
      <div className="border border-hairline bg-surface-sunken px-4 py-3">
        <p className="text-label uppercase text-g-500">Auto-apply gate · read-only</p>
        <p className="mt-1 font-mono text-value text-g-900">
          confidence ≥ {AUTO_APPLY_GATE.confidenceThreshold.toFixed(2)}{" "}
          <span className="font-medium">AND</span> severity ≤{" "}
          {AUTO_APPLY_GATE.maxSeverity}
        </p>
        <p className="mt-1.5 max-w-[420px] text-body text-g-500">
          Named constants in the engine. The evaluation sweeps them; the console
          does not edit them. Everything outside the gate escalates to review.
        </p>
      </div>

      {message ? (
        <p role="alert" className="border border-g-900 bg-surface-sunken px-3 py-2 text-body text-g-900">
          {message}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-hairline pt-5">
        <Button asChild variant="ghost">
          <Link href="/runs" className="no-underline">
            Cancel
          </Link>
        </Button>
        <Button onClick={start} disabled={!ready || starting} type="button">
          {starting ? "Starting…" : "Start run"}
        </Button>
      </div>
    </div>
  );
}
